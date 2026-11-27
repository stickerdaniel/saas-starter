import * as Data from 'effect/Data';
import { untrack } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { ChatDraftManager } from '../core/chat-draft-manager.svelte.ts';
import {
	getChatSessionEpoch,
	isChatSessionCurrent,
	registerPersistedChatHolder,
	type PersistedChatHolder
} from '../core/chat-persisted-state.js';
import type { ChatConversation, ChatSessionPort } from '../core/chat-session-port.svelte.ts';
import type { Attachment } from '../core/types.js';
import type { ChatSendSnapshot } from './chat-context.svelte.ts';
import {
	ComposerAttachmentCoordinator,
	conversationKey as keyOf,
	uploadProfileOf,
	type AttachmentView,
	type ComposerAttachmentSendSnapshot,
	type ComposerUploadFileOptions,
	type ConversationKey
} from './composer-attachment-coordinator.svelte.ts';

/** A mounted view of the composer: the session it shows and what its uploads use. */
export interface ComposerView extends AttachmentView {
	readonly core: Pick<ChatSessionPort, 'conversation' | 'forgetChatSession'>;
}

export type ComposerSendOutcome = 'accepted' | 'refused';

/**
 * When the text of a thread reaches the draft store: on every edit, or only
 * when its view moves to another conversation and when the conversation
 * receives its thread id.
 */
type DraftSaving = 'while-typing' | 'on-switch';

type ChatComposerOptions = {
	saveDrafts?: DraftSaving;
} & (
	| { surface?: undefined; storeFiles?: never }
	| {
			/** Names the draft store. Without one, text lives only while a view shows it. */
			surface: string;
			/**
			 * Keeps uploaded files in the surface's attachment store across reloads.
			 * Every view of such a composer uploads directly.
			 */
			storeFiles?: boolean;
	  }
);

/** The stored draft of a send's thread when the send began. */
type DraftMark = {
	readonly threadId: string | null;
	readonly writes: number;
	readonly stored: string;
};

type PendingSend = {
	readonly id: number;
	readonly sessionEpoch: number;
	readonly snapshot: ChatSendSnapshot;
	readonly draft: DraftMark;
};

type SendEntry = Data.TaggedEnum<{
	Open: { readonly send: PendingSend };
	Settled: { readonly send: PendingSend; readonly outcome: ComposerSendOutcome };
	Abandoned: { readonly release: () => void };
}>;
const SendEntry = Data.taggedEnum<SendEntry>();
type LiveEntry = Data.TaggedEnum.Value<SendEntry, 'Open' | 'Settled'>;

const SEPARATOR = '\n\n';

function sameConversation(a: ChatConversation, b: ChatConversation): boolean {
	return keyOf(a) === keyOf(b);
}

function joinWork(texts: string[], newer: string): string {
	return [...texts, newer].filter((text) => text.trim() !== '').join(SEPARATOR);
}

function sentAttachments(sends: PendingSend[]): Attachment[] {
	const sent = sends.flatMap((send) => send.snapshot.attachments.attachments);
	const keyOfAttachment = (attachment: Attachment) =>
		'key' in attachment ? attachment.key : undefined;
	return sent.filter((attachment, index) => {
		const key = keyOfAttachment(attachment);
		return !key || sent.findIndex((other) => keyOfAttachment(other) === key) === index;
	});
}

/**
 * The text, the attachments and the sends of one chat surface and session,
 * independently of the views that come and go on it.
 *
 * Text and attachments live here per conversation: under its thread id, or
 * under the conversation itself until it receives one. Text is held in memory
 * only for conversations a view shows and conversations without a thread id;
 * storage is the authority for every other thread, which another tab may
 * change. A thread no view shows keeps here only the files storage cannot hold.
 *
 * A refused send is put back only once every send of its conversation that
 * overlapped it has an outcome, all refused ones in send order and ahead of
 * whatever the user wrote since. Restoring each refusal as it arrived would
 * interleave text with a send that could still fail.
 *
 * Browser-side settlement only: it does not make the backend mutation
 * exactly-once.
 */
export class ChatComposer implements PersistedChatHolder {
	private readonly drafts?: ChatDraftManager;
	private readonly files: ComposerAttachmentCoordinator;
	private readonly saveWhileTyping: boolean;
	private readonly texts = new SvelteMap<ConversationKey, string>();
	/** How often this composer wrote each thread's stored draft. */
	private readonly draftWrites = new SvelteMap<string, number>();
	private readonly assignments = new SvelteMap<ChatConversation, () => void>();
	/** Conversations without a thread id whose refused work waits here for one. */
	private readonly refusedWithoutId = new SvelteSet<ChatConversation>();
	private nextSendId = 0;
	private readonly entries = new SvelteMap<number, SendEntry>();
	/** Each view with the conversation it last activated. */
	private readonly views = new SvelteMap<ComposerView, ChatConversation | null>();
	private mounts = 0;
	private unregister: (() => void) | null = null;
	/** The session whose end this composer last let go of, or the one it was made in. */
	private sessionEpoch = getChatSessionEpoch();

	constructor(options: ChatComposerOptions = {}) {
		this.drafts = options.surface ? new ChatDraftManager(options.surface) : undefined;
		this.files = new ComposerAttachmentCoordinator(
			options.storeFiles ? options.surface : undefined
		);
		this.saveWhileTyping = (options.saveDrafts ?? 'while-typing') === 'while-typing';
	}

	/**
	 * Hear about session ends while the surface is mounted, also between its
	 * views. Unmounting detaches every view but keeps pending sends, so a late
	 * refusal still reaches the stores.
	 */
	mount(): () => void {
		untrack(() => {
			this.mounts++;
			this.syncRegistration();
		});
		let mounted = true;
		return () =>
			untrack(() => {
				if (!mounted) return;
				mounted = false;
				this.mounts--;
				for (const view of this.views.keys()) this.detach(view);
				this.syncRegistration();
			});
	}

	/**
	 * Register a view. It shows its conversation once it calls `activate`, and
	 * its uploads use its upload settings. Detaching a view lets go of every
	 * conversation no remaining view shows, files in transfer included.
	 */
	addView(view: ComposerView): () => void {
		this.files.checkView(view);
		untrack(() => {
			this.views.delete(view);
			this.views.set(view, null);
			this.syncRegistration();
		});
		return () => untrack(() => this.detach(view));
	}

	/**
	 * Show the view's current conversation. A conversation another view already
	 * shows keeps what is on screen. Otherwise a thread starts from its stored
	 * draft, unless a pending send carries that copy, and from its stored files.
	 * Returns whether the view left a conversation that had a thread id.
	 */
	activate(view: ComposerView): boolean {
		return untrack(() => {
			const previous = this.views.get(view);
			if (previous === undefined) return false;
			const next = view.core.conversation;
			if (previous === next) return false;
			this.views.set(view, next);
			if (previous && keyOf(previous) === keyOf(next)) return false;
			if (previous) this.leave(previous, !this.saveWhileTyping);
			this.show(next, view);
			return previous !== null && previous.threadId !== null;
		});
	}

	/** The text of `conversation`. */
	textOf(conversation: ChatConversation): string {
		return this.texts.get(keyOf(conversation)) ?? '';
	}

	/** A user edit of the text of `conversation`. */
	edit(conversation: ChatConversation, text: string): void {
		untrack(() => {
			const key = keyOf(conversation);
			if ((this.texts.get(key) ?? '') === text) return;
			this.texts.set(key, text);
			if (typeof key !== 'string') this.watchAssignment(conversation);
			else if (this.saveWhileTyping && (text.trim() || !this.sendCarriesDraft(key))) {
				this.writeDraft(key, text);
			}
		});
	}

	/** Empty the composer for a send it captured, unless the text changed since. */
	clearSent(snapshot: ChatSendSnapshot): void {
		untrack(() => {
			if (!isChatSessionCurrent(snapshot.sessionEpoch)) return;
			const key = keyOf(snapshot.conversation);
			if ((this.texts.get(key) ?? '') === snapshot.inputValue) this.texts.delete(key);
		});
	}

	/** The attachments of `conversation`. */
	attachmentsOf(conversation: ChatConversation): Attachment[] {
		return this.files.listOf(keyOf(conversation));
	}

	/** Whether another file fits the view's cap beside the files its pending sends may bring back. */
	canAddAttachment(view: ComposerView): boolean {
		return (
			this.attachmentsOf(view.core.conversation).length + this.pendingAttachmentCount(view) <
			uploadProfileOf(view.uploadConfig).maxFiles
		);
	}

	addAttachments(view: ComposerView, attachments: Attachment[]): void {
		untrack(() => this.files.addAttachments(keyOf(view.core.conversation), view, attachments));
	}

	removeAttachment(conversation: ChatConversation, index: number): void {
		untrack(() => this.files.removeAttachment(keyOf(conversation), index));
	}

	clearAttachments(conversation: ChatConversation): void {
		untrack(() => this.files.clearAttachments(keyOf(conversation)));
	}

	/** Drop the files of a conversation the surface left for good, stored ones included. */
	discardAttachments(conversation: ChatConversation): void {
		untrack(() => {
			this.files.clearAttachments(keyOf(conversation));
			if (conversation.threadId === null) this.forgetIdle(conversation);
		});
	}

	captureAttachments(conversation: ChatConversation): ComposerAttachmentSendSnapshot {
		return untrack(() => this.files.capture(keyOf(conversation)));
	}

	/** Take a send's files out of the composer. They stay with the send until its outcome. */
	clearSentAttachments(snapshot: ChatSendSnapshot): void {
		untrack(() => {
			if (!isChatSessionCurrent(snapshot.sessionEpoch)) return;
			this.files.clearSent(keyOf(snapshot.conversation), snapshot.attachments);
		});
	}

	uploadFile(
		view: ComposerView,
		file: File | Blob,
		filename?: string,
		options?: ComposerUploadFileOptions
	): Promise<void> {
		return untrack(() =>
			this.files.uploadFile(
				keyOf(view.core.conversation),
				view,
				this.canAddAttachment(view),
				file,
				filename,
				options
			)
		);
	}

	uploadScreenshot(
		view: ComposerView,
		blob: Blob,
		filename: string,
		dimensions?: { width: number; height: number },
		options?: Pick<ComposerUploadFileOptions, 'onPreprocessFailed'>
	): Promise<void> {
		return untrack(() =>
			this.files.uploadScreenshot(
				keyOf(view.core.conversation),
				view,
				this.canAddAttachment(view),
				blob,
				filename,
				dimensions,
				options
			)
		);
	}

	retryUpload(conversation: ChatConversation, index: number): void {
		untrack(() => this.files.retryUpload(keyOf(conversation), index));
	}

	/** Take over a send the composer has just cleared. */
	begin(snapshot: ChatSendSnapshot): number {
		const id = this.nextSendId++;
		const threadId = snapshot.conversation.threadId;
		untrack(() => {
			this.refusedWithoutId.delete(snapshot.conversation);
			this.entries.set(
				id,
				SendEntry.Open({
					send: {
						id,
						sessionEpoch: snapshot.sessionEpoch,
						snapshot,
						draft: {
							threadId,
							writes: threadId === null ? 0 : (this.draftWrites.get(threadId) ?? 0),
							stored: this.drafts?.getDraft(threadId) ?? ''
						}
					}
				})
			);
		});
		return id;
	}

	/** Record a transport outcome. Only the first outcome of a send counts. */
	settle(sendId: number, outcome: ComposerSendOutcome): void {
		untrack(() => {
			const entry = this.entries.get(sendId);
			if (!entry) return;
			SendEntry.$match(entry, {
				Abandoned: ({ release }) => {
					this.entries.delete(sendId);
					if (outcome === 'refused') release();
				},
				Settled: () => {},
				Open: ({ send }) => this.settleOpen(send, outcome)
			});
		});
	}

	private settleOpen(send: PendingSend, outcome: ComposerSendOutcome): void {
		this.entries.set(send.id, SendEntry.Settled({ send, outcome }));
		if (!isChatSessionCurrent(send.sessionEpoch)) {
			this.abandon((candidate) => !isChatSessionCurrent(candidate.sessionEpoch));
			return;
		}
		const { conversation } = send.snapshot;
		const threadId = conversation.threadId;
		if (outcome === 'accepted' && threadId !== null && this.draftCaptured(threadId, [send])) {
			this.writeDraft(threadId, '');
		}

		const group = [...this.liveEntries()].filter(
			({ send: candidate }) =>
				candidate.sessionEpoch === send.sessionEpoch &&
				sameConversation(candidate.snapshot.conversation, conversation)
		);
		if (group.some(SendEntry.$is('Open'))) return;
		for (const { send: candidate } of group) this.entries.delete(candidate.id);
		const refused = group.flatMap((candidate) =>
			candidate._tag === 'Settled' && candidate.outcome === 'refused' ? [candidate.send] : []
		);
		if (refused.length > 0)
			this.publish(
				group.map((candidate) => candidate.send),
				refused
			);
		if (threadId === null) this.forgetIdle(conversation);
		this.dropSurfaceIfIdle();
	}

	/**
	 * Whether a send this owner took over still waits for its outcome or for its
	 * group, or refused work still waits for its conversation's thread id.
	 */
	get hasOutstandingWork(): boolean {
		return untrack(
			() =>
				!this.liveEntries().next().done ||
				this.refusedWithoutId.size > 0 ||
				[...this.texts.keys()].some((key) => typeof key !== 'string' && !this.isShown(key))
		);
	}

	/**
	 * How many files the unsettled sends of the conversation `target` shows
	 * would bring back if refused. An accepted send holds none.
	 */
	pendingAttachmentCount(target: { readonly core: Pick<ChatSessionPort, 'conversation'> }): number {
		const shown = target.core.conversation;
		const holding = [...this.liveEntries()]
			.filter((entry) => entry._tag === 'Open' || entry.outcome === 'refused')
			.map((entry) => entry.send)
			.filter(
				(send) =>
					isChatSessionCurrent(send.sessionEpoch) &&
					sameConversation(send.snapshot.conversation, shown)
			);
		return sentAttachments(holding).length;
	}

	/**
	 * Let go of everything the ended session left here: abandon its sends, which
	 * keep what their files are owed, drop every text and file, and reset the
	 * session of every view. Runs once per session end.
	 */
	forgetPersistedState(): void {
		untrack(() => {
			if (isChatSessionCurrent(this.sessionEpoch)) return;
			this.sessionEpoch = getChatSessionEpoch();
			for (const unsubscribe of this.assignments.values()) unsubscribe();
			this.assignments.clear();
			this.refusedWithoutId.clear();
			this.abandon(() => true);
			this.files.forget();
			this.texts.clear();
			this.draftWrites.clear();
			for (const view of this.views.keys()) view.core.forgetChatSession();
		});
	}

	private *liveEntries(): Generator<LiveEntry> {
		for (const entry of this.entries.values()) if (entry._tag !== 'Abandoned') yield entry;
	}

	private syncRegistration(): void {
		const wanted = typeof window !== 'undefined' && (this.mounts > 0 || this.views.size > 0);
		if (wanted && !this.unregister) this.unregister = registerPersistedChatHolder(this);
		if (!wanted && this.unregister) {
			this.unregister();
			this.unregister = null;
		}
	}

	private detach(view: ComposerView): void {
		const shown = this.views.get(view);
		if (!this.views.delete(view)) return;
		if (shown) this.leave(shown, false);
		for (const key of this.files.keys()) {
			if (this.isShown(key)) continue;
			if (typeof key !== 'string' && this.refusedWithoutId.has(key)) continue;
			this.files.dispose(key);
			if (typeof key !== 'string') this.forgetIdle(key);
		}
		this.syncRegistration();
	}

	/** Whether a view other than `except` shows the conversation under `key`. */
	private isShown(key: ConversationKey, except?: ComposerView): boolean {
		return [...this.views].some(
			([view, shown]) => view !== except && shown !== null && keyOf(shown) === key
		);
	}

	/**
	 * Let go of the text of a conversation a view stopped showing, unless another
	 * view still shows it. A conversation without a thread id keeps its text
	 * while one of its sends is open, so the text moves to the id the send may
	 * still assign. Files stay, so a transfer still running lands where it
	 * belongs.
	 */
	private leave(conversation: ChatConversation, save: boolean): void {
		const key = keyOf(conversation);
		if (this.isShown(key)) return;
		if (typeof key !== 'string') {
			this.forgetIdle(key);
			return;
		}
		const text = this.texts.get(key) ?? '';
		if (save && text.trim()) this.writeDraft(key, text);
		this.texts.delete(key);
	}

	private show(conversation: ChatConversation, view: ComposerView): void {
		const key = keyOf(conversation);
		if (typeof key !== 'string') this.watchAssignment(conversation);
		if (this.isShown(key, view)) return;
		this.files.show(key);
		if (typeof key !== 'string') return;
		const stored = this.drafts && !this.sendCarriesDraft(key) ? this.drafts.getDraft(key) : '';
		if (stored) this.texts.set(key, stored);
		else this.texts.delete(key);
	}

	private watchAssignment(conversation: ChatConversation): void {
		if (this.assignments.has(conversation)) return;
		const sessionEpoch = getChatSessionEpoch();
		this.assignments.set(
			conversation,
			conversation.whenAssigned((threadId) =>
				untrack(() => {
					this.assignments.delete(conversation);
					if (isChatSessionCurrent(sessionEpoch)) this.assigned(conversation, threadId);
				})
			)
		);
	}

	private hasLiveSend(conversation: ChatConversation): boolean {
		return [...this.liveEntries()].some(({ send }) => send.snapshot.conversation === conversation);
	}

	/**
	 * Drop the text of a conversation without a thread id that no view shows, no
	 * send holds and no refusal put back, and stop waiting for its id once no
	 * files wait for it either.
	 */
	private forgetIdle(conversation: ChatConversation): void {
		if (
			this.isShown(conversation) ||
			this.hasLiveSend(conversation) ||
			this.refusedWithoutId.has(conversation)
		) {
			return;
		}
		this.texts.delete(conversation);
		if (this.files.holds(conversation)) return;
		this.assignments.get(conversation)?.();
		this.assignments.delete(conversation);
	}

	/**
	 * Move the work of a conversation that just received its id to that id: its
	 * text behind what the thread already holds, stored once, and its files
	 * beside the thread's.
	 */
	private assigned(conversation: ChatConversation, threadId: string): void {
		this.refusedWithoutId.delete(conversation);
		const moved = this.texts.get(conversation) ?? '';
		this.texts.delete(conversation);
		const present = this.texts.has(threadId)
			? this.texts.get(threadId)!
			: (this.drafts?.getDraft(threadId) ?? '');
		const text = present === moved ? moved : joinWork([present], moved);
		if (text.trim()) this.writeDraft(threadId, text);
		if (this.isShown(threadId) && text) this.texts.set(threadId, text);
		this.files.assign(conversation, threadId);
		this.dropSurfaceIfIdle();
	}

	private writeDraft(threadId: string, text: string): void {
		if (!this.drafts) return;
		this.drafts.setDraft(threadId, text);
		this.draftWrites.set(threadId, (this.draftWrites.get(threadId) ?? 0) + 1);
	}

	/** Whether the stored draft of `threadId` is the one a pending send captured. */
	private sendCarriesDraft(threadId: string): boolean {
		const sends = [...this.liveEntries()]
			.map((entry) => entry.send)
			.filter(
				(send) =>
					isChatSessionCurrent(send.sessionEpoch) &&
					send.snapshot.conversation.threadId === threadId
			);
		return this.draftCaptured(threadId, sends);
	}

	/**
	 * Whether the stored draft of `threadId` is the copy one of `sends` took:
	 * nothing wrote it since the send began, and where drafts are stored while
	 * typing it holds the sent text, not a draft another tab stored meanwhile.
	 */
	private draftCaptured(threadId: string, sends: PendingSend[]): boolean {
		const drafts = this.drafts;
		if (!drafts) return false;
		const writes = this.draftWrites.get(threadId) ?? 0;
		const stored = drafts.getDraft(threadId);
		return sends.some(({ draft, snapshot }) => {
			// A conversation created by the send was empty under its new id.
			if (draft.threadId !== threadId) return writes === 0 && stored === '';
			if (this.saveWhileTyping && stored !== snapshot.inputValue) return false;
			return draft.writes === writes && draft.stored === stored;
		});
	}

	/**
	 * Abandon these sends: stop restoring them but keep what their files are
	 * owed. Stored files stay where they are. Otherwise a known refusal releases
	 * them now, and an open send keeps only that release for a refusal still to
	 * come, since it may yet be accepted.
	 */
	private abandon(ended: (send: PendingSend) => boolean): void {
		for (const entry of this.liveEntries()) {
			const { send } = entry;
			if (!ended(send)) continue;
			const attachments = send.snapshot.attachments.attachments;
			const owed = !this.files.storesFiles && attachments.length > 0;
			if (owed && entry._tag === 'Open') {
				this.entries.set(
					send.id,
					SendEntry.Abandoned({ release: () => this.files.release(attachments) })
				);
				continue;
			}
			this.entries.delete(send.id);
			if (owed && entry._tag === 'Settled' && entry.outcome === 'refused') {
				this.files.release(attachments);
			}
		}
		this.dropSurfaceIfIdle();
	}

	private dropSurfaceIfIdle(): void {
		const surface = surfaceOwnerOf.get(this);
		if (surface && !this.hasOutstandingWork) dropSurfaceOwnerIfUnused(surface);
	}

	/**
	 * Put refused text back: into the conversation a view shows, into the stored
	 * draft of a thread no view shows, and into the entry of a conversation that
	 * has no thread id yet until it receives one.
	 */
	private restoreText(conversation: ChatConversation, texts: string[], group: PendingSend[]): void {
		const key = keyOf(conversation);
		if (this.isShown(key)) {
			const text = joinWork(texts, this.texts.get(key) ?? '');
			this.texts.set(key, text);
			if (typeof key === 'string') this.writeDraft(key, text);
			else this.awaitId(key);
			return;
		}
		if (!this.drafts) return;
		if (typeof key !== 'string') {
			this.texts.set(key, joinWork(texts, this.texts.get(key) ?? ''));
			this.awaitId(key);
			return;
		}
		const stored = this.draftCaptured(key, group) ? '' : this.drafts.getDraft(key);
		this.writeDraft(key, joinWork(texts, stored));
	}

	/**
	 * Wait for the thread id of a conversation whose refused text was put back.
	 * A surface with a draft store keeps that text until then, whichever views
	 * come and go.
	 */
	private awaitId(conversation: ChatConversation): void {
		this.watchAssignment(conversation);
		if (this.drafts) this.refusedWithoutId.add(conversation);
	}

	/**
	 * Put refused files back: into the conversation a view shows, into storage
	 * for a thread no view shows, and into the entry of a conversation without a
	 * thread id until it receives one. A surface that stores nothing gives them
	 * back to their transports instead.
	 */
	private publish(group: PendingSend[], refused: PendingSend[]): void {
		const conversation = refused.at(-1)!.snapshot.conversation;
		this.restoreText(
			conversation,
			refused.map((send) => send.snapshot.inputValue),
			group
		);
		const key = keyOf(conversation);
		const attachments = sentAttachments(refused);
		if (this.isShown(key)) {
			this.files.restore(key, attachments, { persist: true });
			return;
		}
		if (!this.files.storesFiles) {
			for (const send of refused) this.files.release(send.snapshot.attachments.attachments);
			return;
		}
		if (attachments.length === 0) return;
		if (typeof key === 'string') {
			this.files.storeRefused(key, attachments);
			return;
		}
		this.files.restore(key, attachments, { persist: false });
		this.watchAssignment(conversation);
		this.refusedWithoutId.add(conversation);
	}
}

/** A mounted surface's hold on its composer. Release it when the surface unmounts. */
export type ComposerSendLease = {
	readonly owner: ChatComposer;
	release(): void;
};

type ChatComposerLeaseOptions = {
	saveDrafts?: DraftSaving;
	/** Keeps uploaded files in the surface's attachment store. */
	storeFiles?: boolean;
	/** Receives the next session's lease when the session ends while the surface stays mounted. */
	renewed?: (next: ComposerSendLease) => void;
};

type SurfaceOwner = {
	readonly surface: string;
	readonly owner: ChatComposer;
	readonly sessionEpoch: number;
	leases: number;
	unregister: () => void;
};

const surfaceOwners = new SvelteMap<string, SurfaceOwner>();
const surfaceOwnerOf = new WeakMap<ChatComposer, SurfaceOwner>();

/**
 * The composer of `surface` in this browser session, with the surface's draft
 * store and, with `storeFiles`, its attachment store.
 *
 * A page that is left and entered again while one of its sends is open gets
 * the same composer back, which still knows the stored draft that send carries
 * and puts a refusal into the view now on screen, in order with sends started
 * since. The composer is dropped once no lease holds it and no send is
 * pending, and when the session ends; the next call builds a new one.
 *
 * A surface that stays mounted when its session ends passes `renewed`. It
 * receives a lease on the next session's composer, this lease is released, and
 * the surface rebuilds everything that captured the old composer, which
 * restores nothing any more.
 */
export function acquireChatComposer(
	surface: string,
	options: ChatComposerLeaseOptions = {}
): ComposerSendLease {
	const create = () =>
		new ChatComposer({ surface, saveDrafts: options.saveDrafts, storeFiles: options.storeFiles });
	// The server shares this module between requests and never sends.
	if (typeof window === 'undefined') return { owner: create(), release: () => {} };
	const sessionEpoch = getChatSessionEpoch();
	const current = surfaceOwners.get(surface);
	const held =
		current?.sessionEpoch === sessionEpoch ? current : registerSurfaceOwner(surface, create());
	held.leases++;
	let released = false;
	let stopRenewing = () => {};
	const release = () => {
		if (released) return;
		released = true;
		stopRenewing();
		held.leases--;
		dropSurfaceOwnerIfUnused(held);
	};
	const { renewed } = options;
	if (renewed) {
		stopRenewing = registerPersistedChatHolder({
			forgetPersistedState: () => {
				// Taken during this same session end, so already the next session's.
				if (isChatSessionCurrent(sessionEpoch)) return;
				const next = acquireChatComposer(surface, options);
				release();
				renewed(next);
			}
		});
	}
	return { owner: held.owner, release };
}

function registerSurfaceOwner(surface: string, owner: ChatComposer): SurfaceOwner {
	const entry: SurfaceOwner = {
		surface,
		owner,
		sessionEpoch: getChatSessionEpoch(),
		leases: 0,
		unregister: () => {}
	};
	// The session's end stops the owner being handed out, but it stays
	// registered while a lease or a send still holds it: a surface that kept it
	// may have sent through it since, and the next session end must reach those.
	entry.unregister = registerPersistedChatHolder({
		forgetPersistedState: () => {
			// Created by a surface renewing its lease during this same session end.
			if (isChatSessionCurrent(entry.sessionEpoch)) return;
			if (surfaceOwners.get(surface) === entry) surfaceOwners.delete(surface);
			owner.forgetPersistedState();
		}
	});
	surfaceOwners.set(surface, entry);
	surfaceOwnerOf.set(owner, entry);
	return entry;
}

function dropSurfaceOwnerIfUnused(entry: SurfaceOwner): void {
	if (entry.leases === 0 && !entry.owner.hasOutstandingWork) dropSurfaceOwner(entry);
}

function dropSurfaceOwner(entry: SurfaceOwner): void {
	entry.unregister();
	surfaceOwnerOf.delete(entry.owner);
	if (surfaceOwners.get(entry.surface) === entry) surfaceOwners.delete(entry.surface);
}
