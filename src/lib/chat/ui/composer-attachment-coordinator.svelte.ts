import { untrack } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toast } from 'svelte-sonner';
import type { ConvexClient } from 'convex/browser';
import type {
	AttachmentsByThread,
	ChatAttachmentStore
} from '../core/chat-attachment-store.svelte.ts';
import { registerPersistedChatHolder } from '../core/chat-persisted-state.ts';
import {
	uploadFileWithProgress,
	type ChatUploadApi,
	type AttachmentTextAction
} from '../core/file-uploader.js';
import { MAX_ATTACHMENTS, type Attachment } from '../core/types.js';
import {
	AttachmentTransfer,
	attachmentFileIdentity,
	attachmentProgressRank,
	isAttachmentTransferAbort,
	isSameAttachmentFile,
	isStoredAttachment,
	revokeAttachmentPreview,
	type AttachmentPreprocess,
	type AttachmentTransferSnapshot
} from './attachment-transfer.js';

/** Configuration for composer attachment uploads. */
export interface UploadConfig extends ChatUploadApi {
	/** Translate upload errors in the current locale. */
	translate?: (key: string, params?: Record<string, string | number | bigint | Date>) => string;
	/** Optional access key provider for file control. */
	getAccessKey?: () => string | undefined;
	/** Existing persistence adapter for successful attachment references. */
	attachmentStore?: ChatAttachmentStore;
	/** Optional action used by the attachment text preview. */
	getAttachmentText?: AttachmentTextAction;
}

/** A transfer cannot change a composer's discriminant, identity, or local source. */
type AttachmentSnapshotPatch = Partial<
	Pick<
		Extract<Attachment, { type: 'file' }>,
		'name' | 'mimeType' | 'size' | 'uploadState' | 'width' | 'height' | 'url'
	>
>;

/** The part of the app-wide upload registry needed by a composer. */
export interface ActiveUploadsRegistry {
	claim(owner: object): void;
	release(owner: object): void;
}

export type ComposerAttachmentCoordinatorOptions = {
	getThreadId: () => string | null;
	client: ConvexClient;
	uploadConfig?: UploadConfig;
	activeUploads?: ActiveUploadsRegistry | null;
	onForgetPersistedState?: () => void;
};

export type ComposerAttachmentSendSnapshot = {
	attachments: Attachment[];
};

/**
 * Owns one composer's attachment collection and its thread/persistence lifecycle.
 * Individual preprocessing and transport attempts remain inside AttachmentTransfer.
 */
export class ComposerAttachmentCoordinator {
	/** Rendered attachments for the live composer. */
	attachments = $state<Attachment[]>([]);

	/** Public admission limit shared by every composer input surface. */
	readonly maxAttachments = MAX_ATTACHMENTS;

	/** Attachments held for threads that are not currently live. */
	private readonly parked = new SvelteMap<string, Attachment[]>();

	/** One lifecycle owner for each attachment that can still transfer or retry. */
	private readonly transfers = new SvelteMap<string, AttachmentTransfer>();

	/** Transfer keys that still represent work which should block navigation. */
	private readonly pendingUploads = new SvelteSet<string>();

	/** Takes this coordinator back out of the register of mounted composers. */
	private readonly unregister: () => void;

	private readonly getThreadId: () => string | null;
	private readonly client: ConvexClient;
	private readonly uploadConfig?: UploadConfig;
	private readonly activeUploads: ActiveUploadsRegistry | null;
	private readonly onForgetPersistedState?: () => void;

	/** Last thread observed by the chat rendering this coordinator. */
	private lastThreadId: string | null | undefined = undefined;

	/** Prevent disposal cleanup from being persisted as a deliberately empty composer. */
	private disposed = false;

	constructor(options: ComposerAttachmentCoordinatorOptions) {
		this.getThreadId = options.getThreadId;
		this.client = options.client;
		this.uploadConfig = options.uploadConfig;
		this.activeUploads = options.activeUploads ?? null;
		this.onForgetPersistedState = options.onForgetPersistedState;

		// Restored composers start parked beneath their thread identity. The thread
		// already on screen claims its own immediately, including screenshot uploads
		// started while no ChatRoot is mounted.
		for (const [threadId, attachments] of options.uploadConfig?.attachmentStore?.read() ?? []) {
			this.parked.set(threadId, attachments);
		}
		this.adoptParked(untrack(this.getThreadId));
		this.unregister = registerPersistedChatHolder(this);
	}

	/** Whether another pick can enter the live composer at the normal pick-time cap. */
	get canAddAttachment(): boolean {
		return this.attachments.length < this.maxAttachments;
	}

	/** Whether a file's source or transformed identity is already live. */
	hasFile(name: string, size: number): boolean {
		const picked = `${name}:${size}`;
		return this.attachments.some((attachment) =>
			attachmentFileIdentity(attachment).includes(picked)
		);
	}

	/** Add already-built attachment snapshots and persist any settled references. */
	addAttachments(newAttachments: Attachment[]): void {
		this.attachments = [...this.attachments, ...newAttachments];
		this.persist();
	}

	/** Remove one live attachment and permanently release its owned resources. */
	removeAttachment(index: number): void {
		const removed = this.attachments[index];
		if (removed) {
			this.releaseUpload(removed);
			this.revokePreview(removed);
		}
		this.attachments = this.attachments.filter((_, attachmentIndex) => attachmentIndex !== index);
		this.persist();
	}

	/** Remove every live attachment and permanently release its owned resources. */
	clearAttachments(): void {
		for (const attachment of this.attachments) {
			this.releaseUpload(attachment);
			this.revokePreview(attachment);
		}
		this.attachments = [];
		this.persist();
	}

	captureSendAttachments(): ComposerAttachmentSendSnapshot {
		return {
			attachments: this.attachments.map((attachment) =>
				(attachment.type === 'file' || attachment.type === 'screenshot') && attachment.uploadState
					? { ...attachment, uploadState: { ...attachment.uploadState } }
					: { ...attachment }
			)
		};
	}

	clearSendAttachments(snapshot: ComposerAttachmentSendSnapshot): void {
		// Counts preserve exact multiplicity for legacy unkeyed attachments while
		// keyed uploads use their transfer identity.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const remaining = new Map<string, number>();
		for (const attachment of snapshot.attachments) {
			const identity = ComposerAttachmentCoordinator.attachmentIdentity(attachment);
			remaining.set(identity, (remaining.get(identity) ?? 0) + 1);
		}

		const kept: Attachment[] = [];
		for (const attachment of this.attachments) {
			const identity = ComposerAttachmentCoordinator.attachmentIdentity(attachment);
			const count = remaining.get(identity) ?? 0;
			if (count === 0) {
				kept.push(attachment);
				continue;
			}
			remaining.set(identity, count - 1);
			this.releaseUpload(attachment);
			this.revokePreview(attachment);
		}
		this.attachments = kept;
		this.persist();
	}

	restoreSendAttachments(
		snapshot: ComposerAttachmentSendSnapshot,
		originThreadId: string | null,
		restoreLive: boolean
	): void {
		if (this.disposed || !restoreLive) {
			if (originThreadId !== null) {
				this.uploadConfig?.attachmentStore?.restoreThreadAttachments(
					originThreadId,
					snapshot.attachments
				);
			}
			return;
		}

		this.attachments = ComposerAttachmentCoordinator.mergeSnapshotAttachments(
			snapshot.attachments,
			this.attachments
		);
		this.persist();
	}

	reconcilePersistedAttachments(
		namespace: string,
		threadId: string | null,
		attachments: Attachment[]
	): void {
		if (
			this.disposed ||
			this.uploadConfig?.attachmentStore?.namespace !== namespace ||
			untrack(this.getThreadId) !== threadId
		) {
			return;
		}
		this.attachments = ComposerAttachmentCoordinator.mergeSnapshotAttachments(
			attachments,
			this.attachments
		);
	}

	/**
	 * Reconcile the live composer with the currently observed thread.
	 *
	 * Returns true only for navigation away from a real thread, which is the same
	 * transition on which ChatUIContext resets message animation state.
	 */
	syncThread(): boolean {
		const currentThreadId = untrack(this.getThreadId);
		let navigatedBetweenThreads = false;

		if (this.lastThreadId === undefined) {
			this.adoptParked(currentThreadId ?? null);
		} else if (currentThreadId !== this.lastThreadId) {
			if (this.lastThreadId === null) {
				// The no-id conversation is this thread now. Remove only this composer's
				// settled copies from the shared empty key, then leave other tabs' copies.
				this.parked.delete('');
				this.adoptParked(currentThreadId ?? null);
				this.parked.set('', this.strangersUnderEmptyKey());
				this.persist('');
			} else {
				this.parkAttachments(this.lastThreadId, currentThreadId ?? null);
				navigatedBetweenThreads = true;
			}
		}
		this.lastThreadId = currentThreadId;
		return navigatedBetweenThreads;
	}

	/**
	 * Drop everything held for the session that ended, including state which has
	 * not reached persistence yet.
	 */
	forgetPersistedState(): void {
		const abandoned = [...this.parked.keys()];
		for (const attachments of this.parked.values()) {
			for (const attachment of attachments) {
				this.releaseUpload(attachment);
				this.revokePreview(attachment);
			}
		}
		this.parked.clear();
		this.clearAttachments();
		this.onForgetPersistedState?.();
		this.persist(...abandoned);
	}

	/**
	 * Upload a file after synchronously inserting its source-identity placeholder.
	 */
	async uploadFile(
		file: File | Blob,
		filename?: string,
		options?: { preprocess?: AttachmentPreprocess }
	): Promise<void> {
		if (!this.uploadConfig) {
			throw new Error('Upload config not provided to ChatUIContext');
		}
		if (!this.canAddAttachment) return;

		const initialName = filename ?? (file instanceof File ? file.name : 'file');
		const key = crypto.randomUUID();
		const isImageType = file.type.startsWith('image/');
		const placeholder: Attachment = {
			type: 'file',
			key,
			name: initialName,
			size: file.size,
			mimeType: file.type,
			preview: isImageType ? URL.createObjectURL(file) : undefined,
			// The rendered text preview, not the transfer, owns this source File.
			file: !isImageType && file instanceof File ? file : undefined,
			uploadState: { status: 'uploading', progress: 0 },
			sourceName: initialName,
			sourceSize: file.size
		};
		this.attachments = [...this.attachments, placeholder];

		const transfer = this.createTransfer(
			key,
			file,
			initialName,
			file.type,
			this.uploadConfig.getAccessKey?.()
		);
		const result = await transfer.start(options?.preprocess);

		if (result.status !== 'preprocess-failed') return;
		const stillPresent = this.findAttachment(key) !== undefined;
		this.discardAttachment(key);
		if (isAttachmentTransferAbort(result.error) || !stillPresent) return;
		const translate = this.uploadConfig.translate;
		toast.error(
			translate?.('chat.error.upload_failed', { filename: initialName }) ??
				`Failed to upload "${initialName}"`
		);
	}

	/** Upload a screenshot whose blob already is the exact retry payload. */
	async uploadScreenshot(
		blob: Blob,
		filename: string,
		dimensions?: { width: number; height: number }
	): Promise<void> {
		if (!this.uploadConfig) {
			throw new Error('Upload config not provided to ChatUIContext');
		}
		if (!this.canAddAttachment) return;

		const key = crypto.randomUUID();
		const attachment: Attachment = {
			type: 'screenshot',
			key,
			name: filename,
			size: blob.size,
			mimeType: blob.type,
			preview: URL.createObjectURL(blob),
			uploadState: { status: 'uploading', progress: 0 },
			width: dimensions?.width,
			height: dimensions?.height
		};
		this.attachments = [...this.attachments, attachment];

		const transfer = this.createTransfer(
			key,
			blob,
			filename,
			blob.type,
			this.uploadConfig.getAccessKey?.(),
			dimensions,
			false
		);
		await transfer.start();
	}

	/** Retry with the transfer's exact retained post-preprocessing payload. */
	retryUpload(index: number): void {
		const attachment = this.attachments[index];
		if (!attachment || !('key' in attachment) || !attachment.key) return;
		void this.transfers.get(attachment.key)?.retry();
	}

	get hasUploadingFiles(): boolean {
		return this.attachments.some(
			(attachment) =>
				(attachment.type === 'file' || attachment.type === 'screenshot') &&
				attachment.uploadState?.status === 'uploading'
		);
	}

	get hasFailedUploads(): boolean {
		return this.attachments.some(
			(attachment) =>
				(attachment.type === 'file' || attachment.type === 'screenshot') &&
				attachment.uploadState?.status === 'error'
		);
	}

	get uploadedFileIds(): string[] {
		return this.attachments
			.filter(
				(attachment): attachment is Extract<Attachment, { type: 'file' | 'screenshot' }> =>
					(attachment.type === 'file' || attachment.type === 'screenshot') &&
					attachment.uploadState?.status === 'success'
			)
			.map((attachment) => attachment.uploadState!.fileId!)
			.filter(Boolean);
	}

	/** Permanently release every live and parked attachment owned by this surface. */
	dispose(): void {
		if (this.disposed) return;
		this.unregister();
		this.disposed = true;
		for (const attachments of this.parked.values()) {
			for (const attachment of attachments) {
				this.releaseUpload(attachment);
				this.revokePreview(attachment);
			}
		}
		this.parked.clear();
		this.clearAttachments();
		this.pendingUploads.clear();
		this.activeUploads?.release(this);
	}

	/** What the shared no-thread key contains that this composer did not put there. */
	private strangersUnderEmptyKey(): Attachment[] {
		const stored = this.uploadConfig?.attachmentStore?.readThread(null) ?? [];
		// Lives and dies inside this call.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const mine = new Set(
			this.attachments.map((attachment) => ('key' in attachment ? attachment.key : undefined))
		);
		return stored.filter((attachment) => !('key' in attachment) || !mine.has(attachment.key));
	}

	/** Persist only the live thread and explicitly changed parked threads. */
	private persist(...alsoChanged: Array<string | null>): void {
		const store = this.uploadConfig?.attachmentStore;
		if (!store || this.disposed) return;
		const liveKey = untrack(this.getThreadId) ?? '';

		// Handed straight to the store, never rendered.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const snapshot: AttachmentsByThread = new Map();
		for (const threadId of alsoChanged) {
			const key = threadId ?? '';
			if (key !== liveKey) snapshot.set(key, this.parked.get(key) ?? []);
		}
		snapshot.set(liveKey, this.attachments);
		store.write(snapshot);
	}

	private revokePreview(attachment: Attachment): void {
		revokeAttachmentPreview(attachment);
	}

	private releaseUpload(attachment: Attachment): void {
		const key = 'key' in attachment ? attachment.key : undefined;
		if (!key) return;
		this.transfers.get(key)?.dispose();
		this.transfers.delete(key);
		this.settlePending(key);
	}

	private markPending(key: string): void {
		const firstPending = this.pendingUploads.size === 0;
		this.pendingUploads.add(key);
		if (firstPending) this.activeUploads?.claim(this);
	}

	private settlePending(key: string): void {
		this.pendingUploads.delete(key);
		if (this.pendingUploads.size === 0) this.activeUploads?.release(this);
	}

	/** Park the outgoing live list and restore the entering thread's current authority. */
	private parkAttachments(leaving: string, entering: string | null): void {
		if (this.attachments.length > 0) this.parked.set(leaving, this.attachments);
		const key = entering ?? '';
		const store = this.uploadConfig?.attachmentStore;
		const held = this.parked.get(key) ?? [];
		const carried: Attachment[] = [];
		for (const attachment of held) {
			if (store && isStoredAttachment(attachment)) {
				this.revokePreview(attachment);
				continue;
			}
			carried.push(attachment);
		}
		this.attachments = carried;
		this.parked.delete(key);
		const stored = store?.readThread(entering) ?? [];
		if (stored.length > 0) {
			this.parked.set(key, stored);
			this.adoptParked(entering);
		}
		this.persist(leaving);
	}

	/** Adopt parked/live copies for one thread, retaining whichever progressed further. */
	private adoptParked(threadId: string | null): void {
		const key = threadId ?? '';
		const parked = this.parked.get(key);
		if (!parked) return;
		this.parked.delete(key);

		const supersededLive = this.attachments.map(() => false);
		const adopted: Attachment[] = [];
		for (const candidate of parked) {
			const rivalIndex = this.attachments.findIndex(
				(live, index) => !supersededLive[index] && isSameAttachmentFile(candidate, live)
			);
			const rival = rivalIndex === -1 ? undefined : this.attachments[rivalIndex];
			if (!rival) {
				adopted.push(candidate);
				continue;
			}
			if (attachmentProgressRank(candidate) >= attachmentProgressRank(rival)) {
				supersededLive[rivalIndex] = true;
				this.releaseUpload(rival);
				this.revokePreview(rival);
				adopted.push(candidate);
			} else {
				this.releaseUpload(candidate);
				this.revokePreview(candidate);
			}
		}

		this.attachments = [
			...adopted,
			...this.attachments.filter((_, index) => !supersededLive[index])
		];
		this.persist(threadId);
	}

	private static mergeSnapshotAttachments(
		snapshot: Attachment[],
		current: Attachment[]
	): Attachment[] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const currentByIdentity = new Map(
			current.map((attachment) => [
				ComposerAttachmentCoordinator.attachmentIdentity(attachment),
				attachment
			])
		);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const included = new Set<string>();
		const merged: Attachment[] = [];
		for (const attachment of snapshot) {
			const identity = ComposerAttachmentCoordinator.attachmentIdentity(attachment);
			if (included.has(identity)) continue;
			included.add(identity);
			merged.push(
				currentByIdentity.get(identity) ??
					ComposerAttachmentCoordinator.withoutRevokedPreview(attachment)
			);
		}
		for (const attachment of current) {
			const identity = ComposerAttachmentCoordinator.attachmentIdentity(attachment);
			if (included.has(identity)) continue;
			included.add(identity);
			merged.push(attachment);
		}
		return merged;
	}

	private static withoutRevokedPreview(attachment: Attachment): Attachment {
		return 'preview' in attachment && attachment.preview?.startsWith('blob:')
			? { ...attachment, preview: undefined }
			: attachment;
	}

	private static attachmentIdentity(attachment: Attachment): string {
		if ('key' in attachment && attachment.key) return `transfer:${attachment.key}`;
		if (attachment.type === 'file' || attachment.type === 'screenshot') {
			return `upload:${attachment.type}:${attachment.name}:${attachment.size}:${attachment.mimeType}:${attachment.url ?? ''}:${attachment.uploadState?.fileId ?? ''}`;
		}
		return `${attachment.type}:${attachment.url}:${attachment.filename ?? ''}`;
	}

	private createTransfer(
		key: string,
		blob: File | Blob,
		filename: string,
		mimeType: string,
		accessKey?: string,
		dimensions?: { width: number; height: number },
		measureImageDimensions = true
	): AttachmentTransfer {
		const config = this.uploadConfig;
		if (!config) throw new Error('Upload config not provided to ChatUIContext');

		const transfer = new AttachmentTransfer({
			key,
			blob,
			filename,
			mimeType,
			dimensions,
			accessKey,
			measureImageDimensions,
			upload: (payload, onProgress, signal) =>
				uploadFileWithProgress(
					this.client,
					payload.blob,
					payload.filename,
					onProgress,
					config,
					payload.dimensions,
					payload.accessKey,
					signal
				),
			onSnapshot: (snapshot) => {
				if (this.transfers.get(key) !== transfer) return;
				if (snapshot.phase === 'preprocessing') return;
				this.applyTransferSnapshot(snapshot);
				if (snapshot.phase === 'success') this.transfers.delete(key);
			},
			onActivityChange: (active) => {
				if (active) this.markPending(key);
				else this.settlePending(key);
			},
			onAttemptError: () => console.error('[ComposerAttachmentCoordinator] Upload failed')
		});
		this.transfers.set(key, transfer);
		return transfer;
	}

	private applyTransferSnapshot(snapshot: AttachmentTransferSnapshot): void {
		const uploadState =
			snapshot.phase === 'success'
				? { status: 'success' as const, progress: 100, fileId: snapshot.fileId }
				: snapshot.phase === 'error'
					? { status: 'error' as const, progress: 0, error: snapshot.error }
					: { status: 'uploading' as const, progress: snapshot.progress };
		const patch: AttachmentSnapshotPatch = {
			name: snapshot.name,
			mimeType: snapshot.mimeType,
			size: snapshot.size,
			uploadState
		};
		if (snapshot.dimensions) {
			patch.width = snapshot.dimensions.width;
			patch.height = snapshot.dimensions.height;
		}
		if (snapshot.phase === 'success') patch.url = snapshot.url;
		this.patchAttachment(snapshot.key, patch);
	}

	/** Rewrite every live or parked list which contains this transfer identity. */
	private rewriteLists(key: string, rewrite: (list: Attachment[]) => Attachment[]): void {
		const holds = (list: Attachment[]) =>
			list.some((attachment) => 'key' in attachment && attachment.key === key);
		if (holds(this.attachments)) this.attachments = rewrite(this.attachments);
		const rewritten: string[] = [];
		for (const [threadId, attachments] of this.parked) {
			if (!holds(attachments)) continue;
			rewritten.push(threadId);
			const next = rewrite(attachments);
			if (next.length > 0) this.parked.set(threadId, next);
			else this.parked.delete(threadId);
		}
		this.persist(...rewritten);
	}

	private findAttachment(key: string): Attachment | undefined {
		const matches = (attachment: Attachment) => 'key' in attachment && attachment.key === key;
		const live = this.attachments.find(matches);
		if (live) return live;
		for (const attachments of this.parked.values()) {
			const parked = attachments.find(matches);
			if (parked) return parked;
		}
		return undefined;
	}

	private patchAttachment(key: string, patch: AttachmentSnapshotPatch): void {
		this.rewriteLists(key, (attachments) =>
			attachments.map((attachment) =>
				'key' in attachment && attachment.key === key ? { ...attachment, ...patch } : attachment
			)
		);
	}

	private discardAttachment(key: string): void {
		const attachment = this.findAttachment(key);
		if (attachment) {
			this.releaseUpload(attachment);
			this.revokePreview(attachment);
		}
		this.rewriteLists(key, (attachments) =>
			attachments.filter((attachment) => !('key' in attachment) || attachment.key !== key)
		);
	}
}
