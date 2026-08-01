import { PersistedState } from 'runed';
import * as v from 'valibot';
import type { Attachment } from './types.js';
import { ATTACHMENT_STORAGE_PREFIX } from './chat-persisted-state.js';

/**
 * How long a stored attachment is offered back.
 *
 * `files/vacuum.ts` deletes a file nothing references 24 hours after it was
 * last touched, and an attachment nobody sent is never touched again. Offering
 * one back past that would show a tile for a file that is gone and send a dead
 * fileId, so this window stays comfortably inside it. Change one and look at
 * the other.
 *
 * Applied on read, so a browser closed for a week cleans up on the way back in
 * rather than needing something to run while it is shut.
 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

/**
 * What is left of an attachment once the document is gone.
 *
 * Everything here is JSON, and what is missing is the point: `file` and `blob`
 * are the bytes, `preview` is a `blob:` URL that no longer resolves, and `key`
 * names a transfer that no longer exists. `status` and `progress` are not
 * stored either, because only a finished upload is ever written.
 *
 * `savedAt` is when this file reached the server, carried across rewrites. It
 * must not be refreshed by later saves: the vacuum counts from the upload, so a
 * composer left open all day would otherwise keep renewing a file that is
 * already being collected.
 */
const storedAttachmentSchema = v.object({
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
 * Turn an attachment into its storable form, or nothing.
 *
 * Only a settled upload qualifies. A transfer still running has its bytes in
 * memory and nothing on the server to point at, and a failed one has neither,
 * so both would come back as a tile for a file that was never stored.
 */
function toStored(attachment: Attachment, savedAt: number): StoredAttachment | undefined {
	if (attachment.type !== 'file' && attachment.type !== 'screenshot') return undefined;
	const state = attachment.uploadState;
	if (state?.status !== 'success' || !state.fileId || !attachment.url) return undefined;
	return {
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

/** Rebuild the composer entry. Matches what a just-finished upload looks like. */
function fromStored(stored: StoredAttachment): Attachment {
	return {
		type: stored.type,
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
 * Keeps uploaded attachments across a reload, per thread and per surface.
 *
 * The sibling of `ChatDraftManager`: the text a user left in the composer
 * already survives a refresh, and the file next to it should not be the one
 * thing that does not. Only the reference is kept; the file itself is already
 * in storage once its upload finished.
 */
export class ChatAttachmentStore {
	private readonly stored: PersistedState<StoredRecord>;

	/**
	 * @param surface which chat this belongs to, e.g. `ai-chat`. The namespace
	 * is added here so no caller can spell it differently.
	 */
	constructor(surface: string) {
		this.stored = new PersistedState<StoredRecord>(`${ATTACHMENT_STORAGE_PREFIX}${surface}`, {});
	}

	/** Everything still on offer, oldest entries already dropped. */
	read(): AttachmentsByThread {
		// Handed to the caller and read once; nothing renders from it.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const restored: AttachmentsByThread = new Map();
		const cutoff = Date.now() - MAX_AGE_MS;
		for (const [threadId, items] of Object.entries(this.parse())) {
			const fresh = items.filter((item) => item.savedAt > cutoff).map(fromStored);
			if (fresh.length > 0) restored.set(threadId, fresh);
		}
		return restored;
	}

	/**
	 * Record what the given threads are holding.
	 *
	 * Merged rather than replacing: a thread this caller has never seen belongs
	 * to another tab, and an empty list means the composer was emptied, which is
	 * the one case where an entry has to go.
	 */
	write(snapshot: AttachmentsByThread): void {
		const previous = this.parse();
		const next: StoredRecord = { ...previous };
		const now = Date.now();
		for (const [threadId, attachments] of snapshot) {
			// The stamp belongs to the file, not to this save, so an entry that was
			// already here keeps the one it came with. The lookup lives and dies
			// inside this call.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const stamps = new Map(previous[threadId]?.map((item) => [item.fileId, item.savedAt]));
			const items = attachments
				.map((attachment) => {
					const fileId = 'uploadState' in attachment ? attachment.uploadState?.fileId : undefined;
					const stamped = fileId === undefined ? undefined : stamps.get(fileId);
					return toStored(attachment, stamped ?? now);
				})
				.filter((item): item is StoredAttachment => item !== undefined);
			if (items.length > 0) next[threadId] = items;
			else delete next[threadId];
		}
		// Progress ticks run through here and change nothing, since only finished
		// uploads are stored. Comparing keeps them from rewriting the same bytes
		// a hundred times per file.
		if (JSON.stringify(next) === JSON.stringify(previous)) return;
		this.stored.current = next;
	}

	/**
	 * Read what is on disk, tolerating anything.
	 *
	 * `localStorage` is writable by whoever holds the browser, and its contents
	 * outlive any shape this code has had. A blob that does not parse is dropped
	 * whole rather than per entry: the store is only ever written by this class,
	 * so a mismatch means it is not ours, and unsent attachments are the safest
	 * thing in the app to lose.
	 */
	private parse(): StoredRecord {
		const parsed = v.safeParse(storeSchema, this.stored.current);
		return parsed.success ? parsed.output : {};
	}
}
