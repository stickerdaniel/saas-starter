import { PersistedState } from 'runed';
import * as v from 'valibot';
import type { Attachment } from './types.js';
import {
	ATTACHMENT_STORAGE_PREFIX,
	reconcilePersistedChatAttachments
} from './chat-persisted-state.js';

/**
 * How long a stored attachment is offered back.
 *
 * `files/vacuum.ts` deletes an unreferenced file 24 hours after it was last
 * touched, and an unsent attachment is never touched again. Past that window a
 * restored tile would point at a gone file and send a dead fileId, so this
 * window stays well inside it. A change to one needs a look at the other.
 *
 * The age is checked on read, so a browser closed for a week cleans up when it
 * comes back.
 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * The JSON left of an attachment once the document is gone.
 *
 * `file` and `blob` (the bytes), `preview` (a dead `blob:` URL), and `key` (a
 * gone transfer) are left out. `status` and `progress` are not stored, because
 * only a finished upload is written.
 *
 * `savedAt` is when the file reached the server, carried across rewrites. Later
 * saves must not refresh it: the vacuum counts from the upload, so a composer
 * left open all day would keep renewing a file already being collected.
 */
const storedAttachmentSchema = v.object({
	/**
	 * Taken from the transfer that stored the attachment. Not the fileId: storage
	 * deduplicates by content, so two composers with the same bytes hold the same
	 * fileId.
	 */
	id: v.string(),
	type: v.picklist(['file', 'screenshot']),
	name: v.string(),
	size: v.number(),
	mimeType: v.string(),
	url: v.string(),
	fileId: v.string(),
	savedAt: v.number(),
	width: v.optional(v.number()),
	height: v.optional(v.number()),
	sourceName: v.optional(v.string()),
	sourceSize: v.optional(v.number())
});

const storeSchema = v.record(v.string(), v.array(storedAttachmentSchema));

type StoredAttachment = v.InferOutput<typeof storedAttachmentSchema>;
type StoredRecord = v.InferOutput<typeof storeSchema>;

/** A thread id to the attachments its composer is holding. */
export type AttachmentsByThread = Map<string, Attachment[]>;

/**
 * Only a settled upload has a storable form. A running transfer has nothing on
 * the server yet and a failed one never will, so either would come back as a
 * tile for a file that was never stored.
 */
function toStored(attachment: Attachment, savedAt: number): StoredAttachment | undefined {
	if (attachment.type !== 'file' && attachment.type !== 'screenshot') return undefined;
	const state = attachment.uploadState;
	if (state?.status !== 'success' || !state.fileId || !attachment.url) return undefined;
	// Every upload that reaches this point was keyed when it started.
	if (!attachment.key) return undefined;
	return {
		id: attachment.key,
		type: attachment.type,
		name: attachment.name,
		size: attachment.size,
		mimeType: attachment.mimeType,
		url: attachment.url,
		fileId: state.fileId,
		savedAt,
		width: attachment.width,
		height: attachment.height,
		sourceName: attachment.sourceName,
		sourceSize: attachment.sourceSize
	};
}

/** Rebuilds the composer entry in the shape of a just-finished upload. */
function fromStored(stored: StoredAttachment): Attachment {
	return {
		type: stored.type,
		// The stored identity keeps it the same attachment across loads. Without it
		// the composer falls back to name and size, which two re-encoded files can
		// share, and the keyed list crashes.
		key: stored.id,
		name: stored.name,
		size: stored.size,
		mimeType: stored.mimeType,
		url: stored.url,
		uploadState: { status: 'success', progress: 100, fileId: stored.fileId },
		width: stored.width,
		height: stored.height,
		sourceName: stored.sourceName,
		sourceSize: stored.sourceSize
	};
}

/**
 * Keeps uploaded attachments across a reload, per thread and per surface, like
 * `ChatDraftManager` keeps the text. Only the reference is kept, because the
 * file is already in storage once its upload finished.
 */
export class ChatAttachmentStore {
	readonly namespace: string;
	private readonly stored: PersistedState<StoredRecord>;

	/**
	 * When each attachment reached the server, by transfer identity, for the
	 * lifetime of this document.
	 *
	 * The record can go and come back while the attachment does not: sending clears
	 * the composer, and a failed send puts the same attachments back
	 * (`ChatComposer`). Re-stamping them then would give an hours-old
	 * file another twelve, past the point the vacuum collects it.
	 *
	 * Keyed by transfer and not by file: the agent component returns the existing
	 * fileId for re-uploaded bytes and restarts its clock, so a fileId key would let
	 * the second upload inherit the first one's age and expire early.
	 *
	 * Bounded by the attachments one page load touches.
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered
	private readonly stamps = new Map<string, number>();

	private static transferId(attachment: Attachment): string | undefined {
		return 'key' in attachment ? attachment.key : undefined;
	}

	/**
	 * @param surface which chat this belongs to, e.g. `ai-chat`. The namespace is
	 * added here so no caller can spell it differently.
	 */
	constructor(surface: string) {
		this.namespace = `${ATTACHMENT_STORAGE_PREFIX}${surface}`;
		this.stored = new PersistedState<StoredRecord>(this.namespace, {});
	}

	/** Everything still on offer, with expired entries dropped. */
	read(): AttachmentsByThread {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- handed to the caller and read once, never rendered
		const restored: AttachmentsByThread = new Map();
		for (const [threadId, items] of Object.entries(this.fresh(this.parse()))) {
			restored.set(
				threadId,
				items.map((item) => this.revive(item))
			);
		}
		return restored;
	}

	/**
	 * Reads this thread from current storage when the page returns to it, rather than
	 * reusing the snapshot captured when the page started.
	 */
	readThread(threadId: string | null): Attachment[] {
		const items = this.fresh(this.parse())[threadId ?? ''] ?? [];
		return items.map((item) => this.revive(item));
	}

	private revive(item: StoredAttachment): Attachment {
		// Keeps a restore-then-save from restarting the clock
		this.stamps.set(item.id, item.savedAt);
		return fromStored(item);
	}

	/**
	 * Merges the given threads into storage. A thread this caller did not touch
	 * belongs to another tab. An empty list means the composer was emptied, the one
	 * case that removes an entry.
	 */
	write(snapshot: AttachmentsByThread): void {
		const previous = this.parse();
		// Without this sweep an abandoned thread would stay in storage forever, carried
		// along by every later save.
		const next: StoredRecord = this.fresh(previous);
		const now = Date.now();
		for (const [threadId, attachments] of snapshot) {
			const items = attachments
				.map((attachment) => {
					const transfer = ChatAttachmentStore.transferId(attachment);
					const stamped = transfer === undefined ? undefined : this.stamps.get(transfer);
					const item = toStored(attachment, stamped ?? now);
					if (item && transfer) this.stamps.set(transfer, item.savedAt);
					return item;
				})
				.filter((item): item is StoredAttachment => item !== undefined);
			if (items.length > 0) next[threadId] = items;
			else delete next[threadId];
		}
		// Progress ticks pass through here and change nothing, because only finished
		// uploads are stored. The comparison skips rewriting the same bytes per tick.
		if (JSON.stringify(next) === JSON.stringify(previous)) return;
		this.stored.current = next;
	}

	/** Restore one rejected send without overwriting newer persisted work. */
	restoreThreadAttachments(threadId: string | null, snapshot: Attachment[]): void {
		const key = threadId ?? '';
		const previous = this.parse();
		const current = previous[key] ?? [];
		// Local collections used once to build a deterministic stored snapshot.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this call
		const currentById = new Map(current.map((item) => [item.id, item]));
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this call
		const included = new Set<string>();
		const merged: StoredAttachment[] = [];
		const now = Date.now();

		for (const attachment of snapshot) {
			const transfer = ChatAttachmentStore.transferId(attachment);
			if (!transfer || included.has(transfer)) continue;
			const existing = currentById.get(transfer);
			const restored = existing ?? toStored(attachment, this.stamps.get(transfer) ?? now);
			if (!restored) continue;
			this.stamps.set(transfer, restored.savedAt);
			included.add(transfer);
			merged.push(restored);
		}
		for (const attachment of current) {
			if (included.has(attachment.id)) continue;
			included.add(attachment.id);
			merged.push(attachment);
		}

		const alive = this.fresh({ [key]: merged })[key] ?? [];
		const next = { ...previous };
		if (alive.length > 0) next[key] = alive;
		else delete next[key];
		try {
			if (JSON.stringify(next) !== JSON.stringify(previous)) this.stored.current = next;
		} finally {
			reconcilePersistedChatAttachments(
				this.namespace,
				threadId,
				alive.map((item) => this.revive(item))
			);
		}
	}

	/** Drop what the vacuum may already have collected. */
	private fresh(record: StoredRecord): StoredRecord {
		const cutoff = Date.now() - MAX_AGE_MS;
		const kept: StoredRecord = {};
		for (const [threadId, items] of Object.entries(record)) {
			const alive = items.filter((item) => item.savedAt > cutoff);
			if (alive.length > 0) kept[threadId] = alive;
		}
		return kept;
	}

	/**
	 * `localStorage` is writable by whoever holds the browser and outlives any shape
	 * this code has had. A blob that does not parse is dropped whole: only this
	 * class writes the store, so a mismatch means foreign data, and unsent
	 * attachments are the safest thing in the app to lose.
	 */
	private parse(): StoredRecord {
		const parsed = v.safeParse(storeSchema, this.stored.current);
		return parsed.success ? parsed.output : {};
	}
}
