import * as Data from 'effect/Data';
import type { ChatDraftCheckpoint } from '../core/chat-draft-manager.svelte.ts';
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

/** The checkpoint operations of the surface's draft store. */
export interface ComposerDraftStore {
	getDraft(threadId: string | null): string;
	setDraft(threadId: string | null, text: string): void;
	captureCheckpoint(threadId: string | null): ChatDraftCheckpoint;
	clearDraftIfUnchanged(checkpoint: ChatDraftCheckpoint, threadId?: string | null): boolean;
}

/** Where a send's captured attachments go when no composer on screen takes them back. */
export type ComposerSendResources = {
	/** Keeps refused attachments for a conversation that is not on screen. */
	store?: Pick<ChatAttachmentStore, 'restoreThreadAttachments'>;
	/** Hands refused attachments back to their transport when nothing keeps them. */
	release(attachments: Attachment[]): void;
};

/** A mounted composer the coordinator can put refused work back into. */
export interface ComposerSendTarget {
	/** The session port whose conversation this composer shows. */
	readonly core: Pick<ChatSessionPort, 'conversation'>;
	/** What the composer holds now. Everything in it is newer than the sends it cleared. */
	readonly inputValue: string;
	restoreFailedSend(text: string, attachments: Attachment[]): void;
	sendResources(): ComposerSendResources;
	/** Called whenever a send begins, settles or moves, so the composer can re-read its count. */
	pendingSendsChanged(): void;
}

export type ComposerSendOutcome = 'accepted' | 'refused';

type PendingSend = {
	readonly id: number;
	readonly sessionEpoch: number;
	readonly snapshot: ChatSendSnapshot;
	readonly source: ComposerSendTarget;
	readonly resources: ComposerSendResources;
	readonly draftCheckpoint?: ChatDraftCheckpoint;
};

type SendEntry = Data.TaggedEnum<{
	Open: { readonly send: PendingSend };
	Settled: { readonly send: PendingSend; readonly outcome: ComposerSendOutcome };
	Abandoned: { readonly release: () => void };
}>;
const SendEntry = Data.taggedEnum<SendEntry>();
type LiveEntry = Data.TaggedEnum.Value<SendEntry, 'Open' | 'Settled'>;

/** Refused work of a conversation that is off screen and has no thread id to be stored under yet. */
type HeldRestoration = {
	readonly sessionEpoch: number;
	readonly conversation: ChatConversation;
	readonly texts: string[];
	readonly attachments: Attachment[];
	readonly store?: ComposerSendResources['store'];
	readonly unsubscribe: () => void;
};

const SEPARATOR = '\n\n';

function sameConversation(a: ChatConversation, b: ChatConversation): boolean {
	return a === b || (a.threadId !== null && a.threadId === b.threadId);
}

function joinWork(texts: string[], newer: string): string {
	return [...texts, newer].filter((text) => text.trim() !== '').join(SEPARATOR);
}

function sentAttachments(sends: PendingSend[]): Attachment[] {
	const combined: Attachment[] = [];
	const included = new Set<string>();
	for (const send of sends) {
		for (const attachment of send.snapshot.attachments.attachments) {
			const key = 'key' in attachment ? attachment.key : undefined;
			if (key && included.has(key)) continue;
			if (key) included.add(key);
			combined.push(attachment);
		}
	}
	return combined;
}

/**
 * Settles the sends of one chat surface and session, independently of the
 * composers that come and go on it.
 *
 * A refused send is put back only once every send of its conversation that
 * overlapped it has an outcome, all refused ones in send order and ahead of
 * whatever the user wrote since. Restoring each refusal as it arrived would
 * interleave text with a send that could still fail.
 *
 * Browser-side settlement only: it does not make the backend mutation
 * exactly-once.
 */
export class ComposerSendCoordinator implements PersistedChatHolder {
	readonly drafts?: ComposerDraftStore;
	private nextSendId = 0;
	private readonly entries = new Map<number, SendEntry>();
	private readonly targets = new Set<ComposerSendTarget>();
	private held: HeldRestoration[] = [];
	private unregister: (() => void) | null = null;

	constructor(options: { drafts?: ComposerDraftStore } = {}) {
		this.drafts = options.drafts;
	}

	/**
	 * Hear about session ends while the surface is mounted. Unmounting detaches
	 * every composer but keeps pending sends, so a late refusal still reaches
	 * the stores.
	 */
	mount(): () => void {
		this.unregister ??= registerPersistedChatHolder(this);
		return () => {
			this.unregister?.();
			this.unregister = null;
			this.targets.clear();
		};
	}

	attachTarget(target: ComposerSendTarget): () => void {
		// Re-adding moves it to the end: the latest mount wins a tie.
		this.targets.delete(target);
		this.targets.add(target);
		this.projectHeld(target);
		return () => {
			this.targets.delete(target);
		};
	}

	/** Take over a send the composer has just cleared. */
	begin(source: ComposerSendTarget, snapshot: ChatSendSnapshot): number {
		const id = this.nextSendId++;
		this.entries.set(
			id,
			SendEntry.Open({
				send: {
					id,
					sessionEpoch: snapshot.sessionEpoch,
					snapshot,
					source,
					resources: source.sendResources(),
					draftCheckpoint: this.drafts?.captureCheckpoint(snapshot.conversation.threadId)
				}
			})
		);
		this.pendingChanged();
		return id;
	}

	/** Record a transport outcome. Only the first outcome of a send counts. */
	settle(sendId: number, outcome: ComposerSendOutcome): void {
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
	}

	private settleOpen(send: PendingSend, outcome: ComposerSendOutcome): void {
		this.entries.set(send.id, SendEntry.Settled({ send, outcome }));
		this.pendingChanged();
		if (!isChatSessionCurrent(send.sessionEpoch)) {
			this.abandon((candidate) => !isChatSessionCurrent(candidate.sessionEpoch));
			return;
		}
		if (outcome === 'accepted' && send.draftCheckpoint) {
			this.drafts?.clearDraftIfUnchanged(send.draftCheckpoint, send.snapshot.conversation.threadId);
		}

		const group = [...this.liveEntries()].filter(
			({ send: candidate }) =>
				candidate.sessionEpoch === send.sessionEpoch &&
				sameConversation(candidate.snapshot.conversation, send.snapshot.conversation)
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
		this.dropSurfaceIfIdle();
	}

	/**
	 * Whether a send this owner took over still waits for its outcome or for its
	 * group, or refused work still waits for its conversation's thread id.
	 */
	get hasOutstandingWork(): boolean {
		return !this.liveEntries().next().done || this.held.length > 0;
	}

	/**
	 * What a composer opening `threadId` should show. A stored draft that a
	 * pending send already carries is not shown again.
	 */
	draftFor(threadId: string | null): string {
		const value = this.drafts?.getDraft(threadId) ?? '';
		return value && this.holdsDraft(threadId) ? '' : value;
	}

	/** Whether the stored draft of `threadId` is the one a pending send captured. */
	holdsDraft(threadId: string | null): boolean {
		if (!this.drafts || threadId === null) return false;
		const sends = [...this.liveEntries()]
			.map((entry) => entry.send)
			.filter(
				(send) =>
					isChatSessionCurrent(send.sessionEpoch) &&
					send.snapshot.conversation.threadId === threadId
			);
		return this.storedDraftCaptured(threadId, sends);
	}

	/**
	 * How many files the unsettled sends of the conversation `target` shows
	 * would bring back if refused. An accepted send holds none.
	 */
	pendingAttachmentCount(target: ComposerSendTarget): number {
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

	forgetPersistedState(): void {
		for (const held of this.held) held.unsubscribe();
		this.held = [];
		this.abandon(() => true);
		this.pendingChanged();
	}

	private *liveEntries(): Generator<LiveEntry> {
		for (const entry of this.entries.values()) if (entry._tag !== 'Abandoned') yield entry;
	}

	private pendingChanged(): void {
		for (const target of this.targets) target.pendingSendsChanged();
	}

	/**
	 * Stop restoring these sends but keep what their files are owed. Stored
	 * files stay where they are. Otherwise a known refusal releases them now,
	 * and an open send keeps only that release for a refusal still to come,
	 * since it may yet be accepted.
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

	private storedDraftCaptured(threadId: string, sends: PendingSend[]): boolean {
		const drafts = this.drafts;
		if (!drafts) return false;
		const now = drafts.captureCheckpoint(threadId);
		return sends.some(({ draftCheckpoint: captured }) => {
			if (!captured || captured.sessionEpoch !== now.sessionEpoch) return false;
			// A conversation created by the send was empty under its new id.
			const revision = captured.threadId === threadId ? captured.revision : 0;
			return revision === now.revision && captured.value === now.value;
		});
	}

	private matchingTarget(
		conversation: ChatConversation,
		preferred?: ComposerSendTarget
	): ComposerSendTarget | undefined {
		const matches = (target: ComposerSendTarget) =>
			sameConversation(conversation, target.core.conversation);
		if (preferred && this.targets.has(preferred) && matches(preferred)) return preferred;
		return [...this.targets].reverse().find(matches);
	}

	private publish(group: PendingSend[], refused: PendingSend[]): void {
		const last = refused.at(-1)!;
		const conversation = last.snapshot.conversation;
		const threadId = conversation.threadId;
		const texts = refused.map((send) => send.snapshot.inputValue);
		const target = this.matchingTarget(conversation, last.source);

		if (target) {
			const text = joinWork(texts, target.inputValue);
			target.restoreFailedSend(text, sentAttachments(refused));
			if (threadId !== null) this.drafts?.setDraft(threadId, text);
			return;
		}

		for (const send of refused) {
			if (!send.resources.store) send.resources.release(send.snapshot.attachments.attachments);
		}
		const kept = refused.filter((send) => send.resources.store);
		if (threadId === null) {
			if (!this.drafts && kept.length === 0) return;
			const held: HeldRestoration = {
				sessionEpoch: last.sessionEpoch,
				conversation,
				texts: this.drafts ? texts : [],
				attachments: sentAttachments(kept),
				store: kept[0]?.resources.store,
				unsubscribe: conversation.whenAssigned((assigned) => this.flushHeld(held, assigned))
			};
			this.held.push(held);
			return;
		}

		if (this.drafts) {
			const stored = this.storedDraftCaptured(threadId, group)
				? ''
				: this.drafts.getDraft(threadId);
			this.drafts.setDraft(threadId, joinWork(texts, stored));
		}
		if (kept.length > 0) {
			kept[0]!.resources.store!.restoreThreadAttachments(threadId, sentAttachments(kept));
		}
	}

	private flushHeld(held: HeldRestoration, threadId: string): void {
		if (!isChatSessionCurrent(held.sessionEpoch)) return;
		this.held = this.held.filter((candidate) => candidate !== held);
		this.restoreHeld(held, threadId);
		this.dropSurfaceIfIdle();
	}

	private restoreHeld(held: HeldRestoration, threadId: string): void {
		const target = this.matchingTarget(held.conversation);
		if (target) {
			const text = joinWork(held.texts, target.inputValue);
			target.restoreFailedSend(text, held.attachments);
			this.drafts?.setDraft(threadId, text);
			return;
		}
		if (this.drafts && held.texts.length > 0) {
			this.drafts.setDraft(threadId, joinWork(held.texts, this.drafts.getDraft(threadId)));
		}
		if (held.attachments.length > 0) {
			held.store?.restoreThreadAttachments(threadId, held.attachments);
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
		for (const held of matching) {
			held.unsubscribe();
			target.restoreFailedSend(joinWork(held.texts, target.inputValue), held.attachments);
		}
	}
}

/** A mounted surface's hold on its settlement owner. Release it when the surface unmounts. */
export type ComposerSendLease = {
	readonly owner: ComposerSendCoordinator;
	release(): void;
};

type SurfaceOwner = {
	readonly surface: string;
	readonly owner: ComposerSendCoordinator;
	readonly sessionEpoch: number;
	leases: number;
	unregister: () => void;
};

const surfaceOwners = new Map<string, SurfaceOwner>();
const surfaceOwnerOf = new WeakMap<ComposerSendCoordinator, SurfaceOwner>();

/**
 * The settlement owner of `surface` in this browser session.
 *
 * A page that is left and entered again while one of its sends is open gets
 * the same owner back, which still knows the stored draft that send carries
 * and puts a refusal into the composer now on screen, in order with sends
 * started since. The owner is dropped once no lease holds it and no send is
 * pending, and when the session ends; `create` builds the next one.
 *
 * A surface that stays mounted when its session ends passes `renewed`. It
 * receives a lease on the next session's owner, this lease is released, and
 * the surface rebuilds everything that captured the old owner, which restores
 * nothing any more.
 */
export function acquireComposerSendCoordinator(
	surface: string,
	create: () => ComposerSendCoordinator,
	renewed?: (next: ComposerSendLease) => void
): ComposerSendLease {
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
	if (renewed) {
		stopRenewing = registerPersistedChatHolder({
			forgetPersistedState: () => {
				// Taken during this same session end, so already the next session's.
				if (isChatSessionCurrent(sessionEpoch)) return;
				const next = acquireComposerSendCoordinator(surface, create, renewed);
				release();
				renewed(next);
			}
		});
	}
	return { owner: held.owner, release };
}

function registerSurfaceOwner(surface: string, owner: ComposerSendCoordinator): SurfaceOwner {
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
