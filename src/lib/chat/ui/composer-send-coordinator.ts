import type { ChatDraftCheckpoint } from '../core/chat-draft-manager.svelte.ts';
import type { ChatAttachmentStore } from '../core/chat-attachment-store.svelte.ts';
import {
	getChatSessionEpoch,
	isChatSessionCurrent,
	registerPersistedChatHolder,
	type PersistedChatHolder
} from '../core/chat-persisted-state.js';
import type { Attachment } from '../core/types.js';
import type { ChatConversationOrigin, ChatSendSnapshot } from './chat-context.svelte.ts';

/** Called by a session port once a conversation that had no thread id receives one. */
export type ThreadOriginBinder = (threadId: string, epoch: number, generation: number) => void;

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
	readonly core: object;
	/** The conversation on screen now. */
	readonly sendOrigin: ChatConversationOrigin;
	/** What the composer holds now. Everything in it is newer than the sends it cleared. */
	readonly inputValue: string;
	bindThreadOrigin(threadId: string, generation: number): void;
	restoreFailedSend(text: string, attachments: Attachment[]): void;
	sendResources(): ComposerSendResources;
	/** Called whenever a send begins, settles or moves, so the composer can re-read its count. */
	pendingSendsChanged(): void;
}

export type ComposerSendOutcome = 'accepted' | 'refused';

type PendingSend = {
	readonly id: number;
	readonly sessionEpoch: number;
	readonly core: object;
	readonly snapshot: ChatSendSnapshot;
	readonly source: ComposerSendTarget;
	readonly resources: ComposerSendResources;
	readonly draftCheckpoint?: ChatDraftCheckpoint;
	outcome?: ComposerSendOutcome;
};

/** Refused work of a conversation that is off screen and has no thread id to be stored under yet. */
type HeldRestoration = {
	readonly sessionEpoch: number;
	readonly core: object;
	readonly origin: ChatConversationOrigin;
	readonly texts: string[];
	readonly attachments: Attachment[];
	readonly store?: ComposerSendResources['store'];
};

type Conversation = { core: object; origin: ChatConversationOrigin };

const SEPARATOR = '\n\n';

function sameConversation(a: Conversation, b: Conversation): boolean {
	if (a.origin === b.origin) return true;
	if (a.origin.threadId !== null) return a.origin.threadId === b.origin.threadId;
	return (
		b.origin.threadId === null && a.core === b.core && a.origin.generation === b.origin.generation
	);
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
	private readonly pending = new Map<number, PendingSend>();
	/**
	 * Sends of an ended session that are still open. Nothing of them is restored
	 * any more, but a refusal still hands their unkept files back to the
	 * transport, which an acceptance must not.
	 */
	private readonly abandoned = new Map<number, () => void>();
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

	/**
	 * The binder a session port calls when a conversation receives its thread
	 * id. It reaches pending sends of that port even after the composer that
	 * captured them is gone.
	 */
	originBinder(core: object): ThreadOriginBinder {
		return (threadId, epoch, generation) => this.bindOrigin(core, threadId, epoch, generation);
	}

	/** Take over a send the composer has just cleared. */
	begin(source: ComposerSendTarget, snapshot: ChatSendSnapshot): number {
		const id = this.nextSendId++;
		this.pending.set(id, {
			id,
			sessionEpoch: snapshot.sessionEpoch,
			core: source.core,
			snapshot,
			source,
			resources: source.sendResources(),
			draftCheckpoint: this.drafts?.captureCheckpoint(snapshot.origin.threadId)
		});
		this.pendingChanged();
		return id;
	}

	/** Record a transport outcome. Only the first outcome of a send counts. */
	settle(sendId: number, outcome: ComposerSendOutcome): void {
		const releaseAbandoned = this.abandoned.get(sendId);
		if (releaseAbandoned) {
			this.abandoned.delete(sendId);
			if (outcome === 'refused') releaseAbandoned();
			return;
		}
		const send = this.pending.get(sendId);
		if (!send || send.outcome) return;
		send.outcome = outcome;
		this.pendingChanged();
		if (!isChatSessionCurrent(send.sessionEpoch)) {
			this.abandon((candidate) => !isChatSessionCurrent(candidate.sessionEpoch));
			return;
		}
		if (outcome === 'accepted' && send.draftCheckpoint) {
			this.drafts?.clearDraftIfUnchanged(send.draftCheckpoint, send.snapshot.origin.threadId);
		}

		const group = [...this.pending.values()].filter(
			(candidate) =>
				candidate.sessionEpoch === send.sessionEpoch &&
				sameConversation(this.conversationOf(candidate), this.conversationOf(send))
		);
		if (group.some((candidate) => !candidate.outcome)) return;
		for (const candidate of group) this.pending.delete(candidate.id);
		const refused = group.filter((candidate) => candidate.outcome === 'refused');
		if (refused.length > 0) this.publish(group, refused);
		this.dropSurfaceIfIdle();
	}

	/** Whether a send this owner took over still waits for its outcome or for its group. */
	get hasPendingSends(): boolean {
		return this.pending.size > 0;
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
		const sends = [...this.pending.values()].filter(
			(send) =>
				isChatSessionCurrent(send.sessionEpoch) && send.snapshot.origin.threadId === threadId
		);
		return this.storedDraftCaptured(threadId, sends);
	}

	/**
	 * How many files the unsettled sends of the conversation `target` shows
	 * would bring back if refused. An accepted send holds none.
	 */
	pendingAttachmentCount(target: ComposerSendTarget): number {
		const shown = { core: target.core, origin: target.sendOrigin };
		const holding = [...this.pending.values()].filter(
			(send) =>
				send.outcome !== 'accepted' &&
				isChatSessionCurrent(send.sessionEpoch) &&
				sameConversation(this.conversationOf(send), shown)
		);
		return sentAttachments(holding).length;
	}

	forgetPersistedState(): void {
		this.abandon(() => true);
		this.held = [];
		this.pendingChanged();
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
		for (const send of this.pending.values()) {
			if (!ended(send)) continue;
			this.pending.delete(send.id);
			const { resources } = send;
			const attachments = send.snapshot.attachments.attachments;
			if (resources.store || attachments.length === 0) continue;
			if (send.outcome === 'refused') resources.release(attachments);
			else if (!send.outcome) this.abandoned.set(send.id, () => resources.release(attachments));
		}
		this.dropSurfaceIfIdle();
	}

	private dropSurfaceIfIdle(): void {
		const surface = surfaceOwnerOf.get(this);
		if (surface && this.pending.size === 0) dropSurfaceOwnerIfUnused(surface);
	}

	private conversationOf(send: PendingSend): Conversation {
		return { core: send.core, origin: send.snapshot.origin };
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
		conversation: Conversation,
		preferred?: ComposerSendTarget
	): ComposerSendTarget | undefined {
		const matches = (target: ComposerSendTarget) =>
			sameConversation(conversation, { core: target.core, origin: target.sendOrigin });
		if (preferred && this.targets.has(preferred) && matches(preferred)) return preferred;
		return [...this.targets].reverse().find(matches);
	}

	private publish(group: PendingSend[], refused: PendingSend[]): void {
		const last = refused.at(-1)!;
		const conversation = this.conversationOf(last);
		const threadId = conversation.origin.threadId;
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
			this.held.push({
				sessionEpoch: last.sessionEpoch,
				core: last.core,
				origin: conversation.origin,
				texts: this.drafts ? texts : [],
				attachments: sentAttachments(kept),
				store: kept[0]?.resources.store
			});
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

	private bindOrigin(core: object, threadId: string, epoch: number, generation: number): void {
		if (!isChatSessionCurrent(epoch)) return;
		for (const target of this.targets) {
			if (target.core === core) target.bindThreadOrigin(threadId, generation);
		}
		const binds = (candidate: { core: object; origin: ChatConversationOrigin }) =>
			candidate.core === core &&
			candidate.origin.threadId === null &&
			candidate.origin.generation === generation;
		for (const send of this.pending.values()) {
			if (send.sessionEpoch === epoch && binds(this.conversationOf(send))) {
				send.snapshot.origin.threadId = threadId;
			}
		}
		this.pendingChanged();

		const bound = this.held.filter((held) => held.sessionEpoch === epoch && binds(held));
		if (bound.length === 0) return;
		this.held = this.held.filter((held) => !bound.includes(held));
		for (const held of bound) {
			held.origin.threadId = threadId;
			const target = this.matchingTarget(held);
			if (target) {
				const text = joinWork(held.texts, target.inputValue);
				target.restoreFailedSend(text, held.attachments);
				this.drafts?.setDraft(threadId, text);
				continue;
			}
			if (this.drafts && held.texts.length > 0) {
				this.drafts.setDraft(threadId, joinWork(held.texts, this.drafts.getDraft(threadId)));
			}
			if (held.attachments.length > 0) {
				held.store?.restoreThreadAttachments(threadId, held.attachments);
			}
		}
	}

	private projectHeld(target: ComposerSendTarget): void {
		const conversation = { core: target.core, origin: target.sendOrigin };
		const matching = this.held.filter(
			(held) => isChatSessionCurrent(held.sessionEpoch) && sameConversation(held, conversation)
		);
		if (matching.length === 0) return;
		this.held = this.held.filter((held) => !matching.includes(held));
		for (const held of matching) {
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
	if (entry.leases === 0 && !entry.owner.hasPendingSends) dropSurfaceOwner(entry);
}

function dropSurfaceOwner(entry: SurfaceOwner): void {
	entry.unregister();
	surfaceOwnerOf.delete(entry.owner);
	if (surfaceOwners.get(entry.surface) === entry) surfaceOwners.delete(entry.surface);
}
