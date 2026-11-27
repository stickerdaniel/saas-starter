import * as Data from 'effect/Data';
import { untrack } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { ChatDraftManager } from '../core/chat-draft-manager.svelte.ts';
import type { ChatAttachmentStore } from '../core/chat-attachment-store.svelte.ts';
import {
	getChatSessionEpoch,
	isChatSessionCurrent,
	registerPersistedChatHolder,
	type PersistedChatHolder
} from '../core/chat-persisted-state.js';
import type { ChatConversation, ChatSessionPort } from '../core/chat-session-port.svelte.ts';
import type { Attachment } from '../core/types.js';
import type { ChatSendSnapshot } from './chat-context.svelte.ts';

/** Where a send's captured attachments go when no composer on screen takes them back. */
export type ComposerSendResources = {
	/** Keeps refused attachments for a conversation that is not on screen. */
	store?: Pick<ChatAttachmentStore, 'restoreThreadAttachments'>;
	/** Hands refused attachments back to their transport when nothing keeps them. */
	release(attachments: Attachment[]): void;
};

/** A mounted view of the composer, which shows the conversation of its session port. */
export interface ComposerSendTarget {
	/** The session port whose conversation this view shows. */
	readonly core: Pick<ChatSessionPort, 'conversation'>;
	restoreAttachments(attachments: Attachment[]): void;
	sendResources(): ComposerSendResources;
	/** Called whenever a send begins, settles or moves, so the view can re-read its count. */
	pendingSendsChanged(): void;
}

export type ComposerSendOutcome = 'accepted' | 'refused';

/**
 * When the text of a thread reaches the draft store: on every edit, or only
 * when its view moves to another conversation and when the conversation
 * receives its thread id.
 */
type DraftSaving = 'while-typing' | 'on-switch';

type ChatComposerOptions = {
	/** Names the draft store. Without one, text lives only while a view shows it. */
	surface?: string;
	saveDrafts?: DraftSaving;
};

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
	readonly source: ComposerSendTarget;
	readonly resources: ComposerSendResources;
	readonly draft: DraftMark;
};

type SendEntry = Data.TaggedEnum<{
	Open: { readonly send: PendingSend };
	Settled: { readonly send: PendingSend; readonly outcome: ComposerSendOutcome };
	Abandoned: { readonly release: () => void };
}>;
const SendEntry = Data.taggedEnum<SendEntry>();
type LiveEntry = Data.TaggedEnum.Value<SendEntry, 'Open' | 'Settled'>;

/** Refused files of a conversation that is off screen and has no thread id to be stored under yet. */
type HeldRestoration = {
	readonly sessionEpoch: number;
	readonly conversation: ChatConversation;
	readonly attachments: Attachment[];
	readonly store?: ComposerSendResources['store'];
};

/** A thread id, or the conversation itself while it has none. */
type TextKey = string | ChatConversation;

const SEPARATOR = '\n\n';

function keyOf(conversation: ChatConversation): TextKey {
	return conversation.threadId ?? conversation;
}

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
 * The text and the sends of one chat surface and session, independently of
 * the views that come and go on it.
 *
 * Text lives here per conversation: under its thread id, or under the
 * conversation itself until it receives one. Only conversations a view shows
 * and conversations without a thread id are held in memory; the draft store
 * is the authority for every other thread, which another tab may change.
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
	private readonly saveWhileTyping: boolean;
	private readonly texts = new SvelteMap<TextKey, string>();
	/** How often this composer wrote each thread's stored draft. */
	private readonly draftWrites = new SvelteMap<string, number>();
	private readonly assignments = new SvelteMap<ChatConversation, () => void>();
	/** Conversations without a thread id whose refused text waits here for one. */
	private readonly refusedWithoutId = new SvelteSet<ChatConversation>();
	private nextSendId = 0;
	private readonly entries = new SvelteMap<number, SendEntry>();
	/** Each view with the conversation it last activated. The latest mount wins a tie. */
	private readonly views = new SvelteMap<ComposerSendTarget, ChatConversation | null>();
	private held: HeldRestoration[] = [];
	private unregister: (() => void) | null = null;

	constructor(options: ChatComposerOptions = {}) {
		this.drafts = options.surface ? new ChatDraftManager(options.surface) : undefined;
		this.saveWhileTyping = (options.saveDrafts ?? 'while-typing') === 'while-typing';
	}

	/**
	 * Hear about session ends while the surface is mounted. Unmounting detaches
	 * every view but keeps pending sends, so a late refusal still reaches the
	 * stores.
	 */
	mount(): () => void {
		this.unregister ??= registerPersistedChatHolder(this);
		return () => {
			this.unregister?.();
			this.unregister = null;
			for (const view of this.views.keys()) this.detach(view);
		};
	}

	/** Register a view. It shows its conversation once it calls `activate`. */
	attachTarget(target: ComposerSendTarget): () => void {
		untrack(() => {
			this.views.delete(target);
			this.views.set(target, null);
			this.projectHeld(target);
		});
		return () => untrack(() => this.detach(target));
	}

	/**
	 * Show the view's current conversation. A conversation another view already
	 * shows keeps the text on screen. Otherwise a thread starts from its stored
	 * draft, unless a pending send carries that copy.
	 */
	activate(view: ComposerSendTarget): void {
		untrack(() => {
			const previous = this.views.get(view);
			if (previous === undefined) return;
			const next = view.core.conversation;
			if (previous === next) return;
			this.views.set(view, next);
			if (previous && keyOf(previous) === keyOf(next)) return;
			if (previous) this.leave(previous, !this.saveWhileTyping);
			this.show(next, view);
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

	/** Take over a send the composer has just cleared. */
	begin(source: ComposerSendTarget, snapshot: ChatSendSnapshot): number {
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
						source,
						resources: source.sendResources(),
						draft: {
							threadId,
							writes: threadId === null ? 0 : (this.draftWrites.get(threadId) ?? 0),
							stored: this.drafts?.getDraft(threadId) ?? ''
						}
					}
				})
			);
		});
		this.pendingChanged();
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
		this.pendingChanged();
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
				this.held.length > 0 ||
				[...this.texts.keys()].some((key) => typeof key !== 'string' && !this.isShown(key))
		);
	}

	/**
	 * How many files the unsettled sends of the conversation `target` shows
	 * would bring back if refused. An accepted send holds none.
	 */
	pendingAttachmentCount(target: ComposerSendTarget): number {
		const shown = target.core.conversation;
		const holding = untrack(() => [...this.liveEntries()])
			.filter((entry) => entry._tag === 'Open' || entry.outcome === 'refused')
			.map((entry) => entry.send)
			.filter(
				(send) =>
					isChatSessionCurrent(send.sessionEpoch) &&
					sameConversation(send.snapshot.conversation, shown)
			);
		return sentAttachments(holding).length;
	}

	forgetPersistedState(): void {
		untrack(() => {
			this.held = [];
			for (const unsubscribe of this.assignments.values()) unsubscribe();
			this.assignments.clear();
			this.refusedWithoutId.clear();
			this.texts.clear();
			this.draftWrites.clear();
			this.abandon(() => true);
		});
		this.pendingChanged();
	}

	private *liveEntries(): Generator<LiveEntry> {
		for (const entry of this.entries.values()) if (entry._tag !== 'Abandoned') yield entry;
	}

	private pendingChanged(): void {
		for (const target of untrack(() => [...this.views.keys()])) target.pendingSendsChanged();
	}

	private detach(view: ComposerSendTarget): void {
		const shown = this.views.get(view);
		if (!this.views.delete(view)) return;
		if (shown) this.leave(shown, false);
	}

	/** Whether a view other than `except` shows the conversation under `key`. */
	private isShown(key: TextKey, except?: ComposerSendTarget): boolean {
		return [...this.views].some(
			([view, shown]) => view !== except && shown !== null && keyOf(shown) === key
		);
	}

	/**
	 * Let go of a conversation a view stopped showing, unless another view still
	 * shows it. A conversation without a thread id keeps its text while one of
	 * its sends is open, so the text moves to the id the send may still assign.
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

	private show(conversation: ChatConversation, view: ComposerSendTarget): void {
		const key = keyOf(conversation);
		if (typeof key !== 'string' || this.isShown(key, view)) return;
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
	 * send holds and no refusal put back, and stop waiting for its id unless
	 * refused files still do.
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
		if (this.held.some((held) => held.conversation === conversation)) return;
		this.assignments.get(conversation)?.();
		this.assignments.delete(conversation);
	}

	/**
	 * Move the work of a conversation that just received its id to that id: its
	 * text behind what the thread already holds, stored once, and its held files.
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
		this.flushHeld(conversation, threadId);
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
			const { resources } = send;
			const attachments = send.snapshot.attachments.attachments;
			const owed = !resources.store && attachments.length > 0;
			if (owed && entry._tag === 'Open') {
				this.entries.set(
					send.id,
					SendEntry.Abandoned({ release: () => resources.release(attachments) })
				);
				continue;
			}
			this.entries.delete(send.id);
			if (owed && entry._tag === 'Settled' && entry.outcome === 'refused') {
				resources.release(attachments);
			}
		}
		this.dropSurfaceIfIdle();
	}

	private dropSurfaceIfIdle(): void {
		const surface = surfaceOwnerOf.get(this);
		if (surface && !this.hasOutstandingWork) dropSurfaceOwnerIfUnused(surface);
	}

	private matchingTarget(
		conversation: ChatConversation,
		preferred?: ComposerSendTarget
	): ComposerSendTarget | undefined {
		const matches = (target: ComposerSendTarget) =>
			sameConversation(conversation, target.core.conversation);
		if (preferred && this.views.has(preferred) && matches(preferred)) return preferred;
		return [...this.views.keys()].reverse().find(matches);
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

	private publish(group: PendingSend[], refused: PendingSend[]): void {
		const last = refused.at(-1)!;
		const conversation = last.snapshot.conversation;
		const threadId = conversation.threadId;
		this.restoreText(
			conversation,
			refused.map((send) => send.snapshot.inputValue),
			group
		);
		const target = this.matchingTarget(conversation, last.source);
		if (target) {
			target.restoreAttachments(sentAttachments(refused));
			return;
		}

		for (const send of refused) {
			if (!send.resources.store) send.resources.release(send.snapshot.attachments.attachments);
		}
		const kept = refused.filter((send) => send.resources.store);
		if (kept.length === 0) return;
		if (threadId === null) {
			this.held.push({
				sessionEpoch: last.sessionEpoch,
				conversation,
				attachments: sentAttachments(kept),
				store: kept[0]?.resources.store
			});
			this.watchAssignment(conversation);
			return;
		}
		kept[0]!.resources.store!.restoreThreadAttachments(threadId, sentAttachments(kept));
	}

	private flushHeld(conversation: ChatConversation, threadId: string): void {
		const flushed = this.held.filter((held) => held.conversation === conversation);
		this.held = this.held.filter((held) => held.conversation !== conversation);
		for (const held of flushed) {
			if (!isChatSessionCurrent(held.sessionEpoch)) continue;
			const target = this.matchingTarget(conversation);
			if (target) target.restoreAttachments(held.attachments);
			else held.store?.restoreThreadAttachments(threadId, held.attachments);
		}
	}

	private projectHeld(target: ComposerSendTarget): void {
		const conversation = target.core.conversation;
		const matching = this.held.filter(
			(held) =>
				isChatSessionCurrent(held.sessionEpoch) && sameConversation(held.conversation, conversation)
		);
		if (matching.length === 0) return;
		this.held = this.held.filter((held) => !matching.includes(held));
		for (const held of matching) target.restoreAttachments(held.attachments);
	}
}

/** A mounted surface's hold on its composer. Release it when the surface unmounts. */
export type ComposerSendLease = {
	readonly owner: ChatComposer;
	release(): void;
};

type ChatComposerLeaseOptions = {
	saveDrafts?: DraftSaving;
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
 * store.
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
	const create = () => new ChatComposer({ surface, saveDrafts: options.saveDrafts });
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
