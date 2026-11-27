import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toast } from 'svelte-sonner';
import { ChatAttachmentStore } from '../core/chat-attachment-store.svelte.ts';
import type { ChatConversation } from '../core/chat-session-port.svelte.ts';
import {
	uploadFileWithProgress,
	type AttachmentTextAction,
	type AttachmentUploadResult,
	type ChatUploadApi,
	type ChatVisitorArgs
} from '../core/file-uploader.js';
import { DEFAULT_ATTACHMENT_PROFILE, type Attachment } from '../core/types.js';
import { checkUploadPayload, type UploadProfile } from '../../uploads/profiles.js';
import { UploadError, type UploadErrorCode } from '../../uploads/transfer.js';
import { logSafeDiagnostic } from '../../monitoring/safe-diagnostic.js';
import {
	AttachmentRefusal,
	AttachmentTransfer,
	attachmentProgressRank,
	isAttachmentTransferAbort,
	isSameAttachmentFile,
	isStoredAttachment,
	revokeAttachmentPreview,
	type AttachmentPreprocess,
	type AttachmentTransferPayload,
	type AttachmentTransferResult,
	type AttachmentTransferSnapshot,
	type AttachmentTransferUpload
} from './attachment-transfer.js';

// The upload codes this repository defines. `UploadError` takes any string at
// runtime, and a custom upload function could pass one that names the file, so
// the failure log writes only these and calls everything else unclassified.
const LOGGED_UPLOAD_CODES: Record<UploadErrorCode, true> = {
	network: true,
	http: true,
	parse: true,
	server: true
};

/** Settings every composer upload surface shares, whatever moves its bytes. */
type UploadConfigBase = {
	translate?: (key: string, params?: Record<string, string | number | bigint | Date>) => string;
	/** Used by the attachment text preview. */
	getAttachmentText?: AttachmentTextAction;
	/** Locale sent with server calls whose errors are translated. */
	locale?: string;
	/** Caller identity sent with the direct upload and the text preview action. */
	getVisitorArgs?: () => ChatVisitorArgs;
	/**
	 * What this surface accepts: types, size caps and the attachment count.
	 * Every entry point and the composer read this one policy.
	 */
	profile?: UploadProfile;
};

/** Uploads through the surface's route on the Convex site URL. */
export type DirectUploadConfig = UploadConfigBase &
	ChatUploadApi & {
		upload?: never;
		release?: never;
		getAccessKey?: never;
	};

/**
 * Uploads through the surface's own transport instead of the upload route.
 *
 * Not for a composer that stores files: a reference restored from storage
 * after its composer released it would point at a resource the surface
 * already gave back.
 */
export type CustomUploadConfig = UploadConfigBase & {
	upload: AttachmentTransferUpload;
	/** Access key handed to the transport with each payload. */
	getAccessKey?: () => string | undefined;
	/**
	 * Gives back a result the composer abandoned before sending it: removed,
	 * replaced or dropped with the composer, or returned by an attempt already
	 * canceled. Called at most once per result. A rejection is reported, never
	 * thrown.
	 */
	release?: (result: AttachmentUploadResult) => Promise<void> | void;
	purpose?: never;
};

export type UploadConfig = DirectUploadConfig | CustomUploadConfig;

/** The upload policy of a view with `config`. */
export function uploadProfileOf(config: UploadConfig | undefined): UploadProfile {
	return config?.profile ?? DEFAULT_ATTACHMENT_PROFILE;
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

/** What a view lends the uploads it starts: its upload settings and the app's upload registry. */
export type AttachmentView = {
	readonly uploadConfig?: UploadConfig;
	readonly activeUploads: ActiveUploadsRegistry | null;
};

export type ComposerUploadFileOptions = {
	preprocess?: AttachmentPreprocess;
	/**
	 * Reports a file whose preprocessing or final check failed while it was
	 * still in the composer, in place of the default toast. `refusal` carries
	 * the text to show when the failure is a known refusal.
	 */
	onPreprocessFailed?: (filename: string, refusal?: AttachmentRefusal) => void;
};

export type ComposerAttachmentSendSnapshot = {
	attachments: Attachment[];
};

/** A thread id, or the conversation itself while it has none. */
export type ConversationKey = string | ChatConversation;

export function conversationKey(conversation: ChatConversation): ConversationKey {
	return conversation.threadId ?? conversation;
}

/** Storage files every conversation without a thread id under the empty key. */
function storageKey(key: ConversationKey): string {
	return typeof key === 'string' ? key : '';
}

function transferKeyOf(attachment: Attachment): string | undefined {
	return 'key' in attachment ? attachment.key : undefined;
}

type ReleaseResult = NonNullable<CustomUploadConfig['release']>;

/** Who takes a result back, and the file ids it took back already. */
type ResultOwner = {
	readonly release?: ReleaseResult;
	readonly released: SvelteSet<string>;
};

/**
 * The attachments of one composer, per conversation, with their transfers and
 * their storage.
 *
 * An upload belongs to the view that starts it: its transfer keeps that view's
 * transport, policy, translations and upload registry until it ends. A result
 * goes back to the release function it was uploaded or added with, once,
 * whichever view shows it later. Individual preprocessing and transport
 * attempts remain inside AttachmentTransfer.
 */
export class ComposerAttachmentCoordinator {
	private readonly store?: ChatAttachmentStore;

	/** The attachments of each conversation, shown or set aside. */
	private readonly lists = new SvelteMap<ConversationKey, Attachment[]>();

	/** One lifecycle owner for each attachment that can still transfer or retry. */
	private readonly transfers = new SvelteMap<string, AttachmentTransfer>();

	/** The owner of each result, carried by every copy of it. Never rendered. */
	private readonly owners = new WeakMap<Attachment, ResultOwner>();

	/** The owner of the results without a transfer that each view added. */
	private keylessOwners = new WeakMap<AttachmentView, ResultOwner>();

	/** @param surface names the attachment store; without one, files live only in memory. */
	constructor(surface?: string) {
		this.store = surface ? new ChatAttachmentStore(surface) : undefined;
	}

	/** Whether refused files of a conversation no view shows go to storage. */
	get storesFiles(): boolean {
		return this.store !== undefined;
	}

	/** Refuse a view whose results storage would outlive. */
	checkView(view: AttachmentView): void {
		if (this.store && view.uploadConfig?.upload) {
			throw new Error('A composer that stores files cannot upload through a custom transport');
		}
	}

	listOf(key: ConversationKey): Attachment[] {
		return this.lists.get(key) ?? [];
	}

	keys(): ConversationKey[] {
		return [...this.lists.keys()];
	}

	holds(key: ConversationKey): boolean {
		return this.lists.has(key);
	}

	/** Persists any settled references among the added snapshots. */
	addAttachments(key: ConversationKey, view: AttachmentView, added: Attachment[]): void {
		for (const attachment of added) this.own(attachment, view);
		this.setList(key, [...this.listOf(key), ...added]);
		this.persist(key);
	}

	/** Remove one attachment and permanently release its owned resources. */
	removeAttachment(key: ConversationKey, index: number): void {
		const list = this.listOf(key);
		const removed = list[index];
		if (removed) this.drop(removed);
		this.setList(
			key,
			list.filter((_, attachmentIndex) => attachmentIndex !== index)
		);
		this.persist(key);
		if (removed) this.releaseAbandoned([removed]);
	}

	/** Remove every attachment of `key`, release its owned resources and store it empty. */
	clearAttachments(key: ConversationKey): void {
		const cleared = this.listOf(key);
		for (const attachment of cleared) this.drop(attachment);
		this.lists.delete(key);
		this.persist(key);
		this.releaseAbandoned(cleared);
	}

	/** Let go of an entry nobody shows any more, leaving its storage as it is. */
	dispose(key: ConversationKey): void {
		const disposed = this.listOf(key);
		for (const attachment of disposed) this.drop(attachment);
		this.lists.delete(key);
		this.releaseAbandoned(disposed);
	}

	capture(key: ConversationKey): ComposerAttachmentSendSnapshot {
		return {
			attachments: this.listOf(key).map((attachment) =>
				this.copy(
					attachment,
					(attachment.type === 'file' || attachment.type === 'screenshot') && attachment.uploadState
						? { ...attachment, uploadState: { ...attachment.uploadState } }
						: { ...attachment }
				)
			)
		};
	}

	clearSent(key: ConversationKey, snapshot: ComposerAttachmentSendSnapshot): void {
		// Counts preserve exact multiplicity for legacy unkeyed attachments while
		// keyed uploads use their transfer identity.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this call
		const remaining = new Map<string, number>();
		for (const attachment of snapshot.attachments) {
			const identity = attachmentIdentity(attachment);
			remaining.set(identity, (remaining.get(identity) ?? 0) + 1);
		}

		const kept: Attachment[] = [];
		for (const attachment of this.listOf(key)) {
			const identity = attachmentIdentity(attachment);
			const count = remaining.get(identity) ?? 0;
			if (count === 0) {
				kept.push(attachment);
				continue;
			}
			remaining.set(identity, count - 1);
			this.drop(attachment);
		}
		this.setList(key, kept);
		this.persist(key);
	}

	/** Put refused attachments back ahead of what the entry holds now. */
	restore(
		key: ConversationKey,
		attachments: Attachment[],
		{ persist }: { persist: boolean }
	): void {
		this.setList(key, this.merge(attachments, this.listOf(key)));
		if (persist) this.persist(key);
	}

	/** Merge refused files into the stored files of a thread no view shows. */
	storeRefused(threadId: string, attachments: Attachment[]): void {
		this.store?.restoreThreadAttachments(threadId, attachments);
	}

	/** Hand sent or dropped results back to their transports once nothing here holds them. */
	release(attachments: Attachment[]): void {
		this.releaseAbandoned(attachments);
	}

	/**
	 * Show `key` from storage. A thread drops the stored copies held for it and
	 * merges what is stored now with the transfers still held, keeping whichever
	 * copy got further: another tab may have added or removed files meanwhile. A
	 * conversation without a thread id keeps what waits for its id and adds the
	 * stored files no other conversation here holds.
	 */
	show(key: ConversationKey): void {
		if (!this.store) return;
		if (typeof key !== 'string') {
			const unclaimed = this.unclaimedWithoutId();
			if (unclaimed.length > 0) this.adopt(key, unclaimed);
			return;
		}
		const carried = this.listOf(key).filter((attachment) => {
			if (!isStoredAttachment(attachment)) return true;
			revokeAttachmentPreview(attachment);
			return false;
		});
		this.setList(key, carried);
		const stored = this.store.readThread(key);
		if (stored.length > 0) this.adopt(key, stored);
	}

	/**
	 * Move the files of a conversation that just received its id to that id,
	 * beside what the thread already holds and stores, and take only this
	 * composer's copies out from under the empty key.
	 */
	assign(conversation: ChatConversation, threadId: string): void {
		const moved = this.lists.get(conversation);
		if (!moved) return;
		this.lists.delete(conversation);
		const local = this.listOf(threadId).filter((attachment) => {
			if (!this.store || !isStoredAttachment(attachment)) return true;
			revokeAttachmentPreview(attachment);
			return false;
		});
		this.setList(threadId, moved);
		this.adopt(threadId, [...(this.store?.readThread(threadId) ?? []), ...local]);
		this.write([['', this.strangersUnderEmptyKey(this.listOf(threadId))]]);
	}

	/** Drops everything held for the ended session, including unpersisted state. */
	forget(): void {
		const keys = this.keys();
		const dropped = [...this.lists.values()].flat();
		for (const attachment of dropped) this.drop(attachment);
		this.lists.clear();
		this.persist(...keys);
		this.releaseAbandoned(dropped);
		this.keylessOwners = new WeakMap();
	}

	/** Inserts the source-identity placeholder synchronously, then uploads. */
	async uploadFile(
		key: ConversationKey,
		view: AttachmentView,
		hasRoom: boolean,
		file: File | Blob,
		filename?: string,
		options?: ComposerUploadFileOptions
	): Promise<void> {
		const config = view.uploadConfig;
		if (!config) {
			throw new Error('Upload config not provided to ChatUIContext');
		}
		if (!hasRoom) return;

		const initialName = filename ?? (file instanceof File ? file.name : 'file');
		const transferKey = crypto.randomUUID();
		const isImageType = file.type.startsWith('image/');
		const placeholder: Attachment = {
			type: 'file',
			key: transferKey,
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
		const transfer = this.createTransfer(view, config, placeholder, {
			key: transferKey,
			blob: file,
			filename: initialName,
			mimeType: file.type
		});
		this.setList(key, [...this.listOf(key), placeholder]);
		this.settleRefusedStart(
			config,
			transferKey,
			initialName,
			await transfer.start(options?.preprocess),
			options?.onPreprocessFailed
		);
	}

	/** Upload a screenshot whose blob already is the exact retry payload. */
	async uploadScreenshot(
		key: ConversationKey,
		view: AttachmentView,
		hasRoom: boolean,
		blob: Blob,
		filename: string,
		dimensions?: { width: number; height: number },
		options?: Pick<ComposerUploadFileOptions, 'onPreprocessFailed'>
	): Promise<void> {
		const config = view.uploadConfig;
		if (!config) {
			throw new Error('Upload config not provided to ChatUIContext');
		}
		if (!hasRoom) return;

		const transferKey = crypto.randomUUID();
		const attachment: Attachment = {
			type: 'screenshot',
			key: transferKey,
			name: filename,
			size: blob.size,
			mimeType: blob.type,
			preview: URL.createObjectURL(blob),
			uploadState: { status: 'uploading', progress: 0 },
			width: dimensions?.width,
			height: dimensions?.height
		};
		const transfer = this.createTransfer(view, config, attachment, {
			key: transferKey,
			blob,
			filename,
			mimeType: blob.type,
			dimensions,
			measureImageDimensions: false
		});
		this.setList(key, [...this.listOf(key), attachment]);
		this.settleRefusedStart(
			config,
			transferKey,
			filename,
			await transfer.start(),
			options?.onPreprocessFailed
		);
	}

	/** Retries with the transfer's retained post-preprocessing payload. */
	retryUpload(key: ConversationKey, index: number): void {
		const attachment = this.listOf(key)[index];
		const transferKey = attachment && transferKeyOf(attachment);
		if (!transferKey) return;
		void this.transfers.get(transferKey)?.retry();
	}

	private setList(key: ConversationKey, list: Attachment[]): void {
		if (list.length > 0) this.lists.set(key, list);
		else this.lists.delete(key);
	}

	/** Cancel the transfer of an attachment leaving the composer and free its preview. */
	private drop(attachment: Attachment): void {
		const key = transferKeyOf(attachment);
		if (key) {
			this.transfers.get(key)?.dispose();
			this.transfers.delete(key);
		}
		revokeAttachmentPreview(attachment);
	}

	/**
	 * Record who takes an added result back: the view's release function, once
	 * per transfer identity, or once per file id among the results that view
	 * added without one.
	 */
	private own(attachment: Attachment, view: AttachmentView): void {
		if (attachment.type !== 'file' && attachment.type !== 'screenshot') return;
		if (this.owners.has(attachment)) return;
		const release = view.uploadConfig?.release;
		if (attachment.key) {
			this.owners.set(attachment, { release, released: new SvelteSet() });
			return;
		}
		let owner = this.keylessOwners.get(view);
		if (!owner) {
			owner = { release, released: new SvelteSet() };
			this.keylessOwners.set(view, owner);
		}
		this.owners.set(attachment, owner);
	}

	/** `next`, a copy of `source`, released by whoever releases `source`. */
	private copy(source: Attachment, next: Attachment): Attachment {
		const owner = this.owners.get(source);
		if (owner) this.owners.set(next, owner);
		return next;
	}

	/**
	 * Hands results back to their transports once nothing here holds them.
	 * Sending clears attachments without this, because a sent result belongs to
	 * its send until the send's outcome decides.
	 */
	private releaseAbandoned(attachments: Attachment[]): void {
		for (const attachment of attachments) {
			if (attachment.type !== 'file' && attachment.type !== 'screenshot') continue;
			const state = attachment.uploadState;
			const owner = this.owners.get(attachment);
			if (state?.status !== 'success' || !state.fileId || !owner?.release) continue;
			if (this.holdsResult(state.fileId, owner.release)) continue;
			this.releaseThrough(owner, { fileId: state.fileId, url: attachment.url ?? '' });
		}
	}

	/** Whether an entry still holds a result with this file id for the same release function. */
	private holdsResult(fileId: string, release: ReleaseResult): boolean {
		for (const list of this.lists.values()) {
			const holds = list.some(
				(attachment) =>
					(attachment.type === 'file' || attachment.type === 'screenshot') &&
					attachment.uploadState?.fileId === fileId &&
					this.owners.get(attachment)?.release === release
			);
			if (holds) return true;
		}
		return false;
	}

	private releaseThrough(owner: ResultOwner, result: AttachmentUploadResult): void {
		const release = owner.release;
		if (!release || owner.released.has(result.fileId)) return;
		owner.released.add(result.fileId);
		const reportFailure = () => console.error('[ComposerAttachmentCoordinator] Release failed');
		try {
			void Promise.resolve(release(result)).catch(reportFailure);
		} catch {
			reportFailure();
		}
	}

	/** What the shared no-thread key contains that is not among `mine`. */
	private strangersUnderEmptyKey(mine: Attachment[]): Attachment[] {
		const stored = this.store?.readThread(null) ?? [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this call
		const keys = new Set(mine.map(transferKeyOf));
		return stored.filter((attachment) => !('key' in attachment) || !keys.has(attachment.key));
	}

	/** Stored files of conversations without a thread id that no entry here holds. */
	private unclaimedWithoutId(): Attachment[] {
		return this.strangersUnderEmptyKey([...this.lists.values()].flat());
	}

	/** Persist the entries of `keys`, and nothing else. */
	private persist(...keys: ConversationKey[]): void {
		this.write(keys.map((key) => [storageKey(key), this.listOf(key)]));
	}

	private write(entries: Array<[string, Attachment[]]>): void {
		if (!this.store || entries.length === 0) return;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- handed straight to the store, never rendered
		this.store.write(new Map(entries));
	}

	/** Adopt `candidates` into the entry of `key`, retaining whichever copy progressed further. */
	private adopt(key: ConversationKey, candidates: Attachment[]): void {
		const live = this.listOf(key);
		const supersededLive = live.map(() => false);
		const adopted: Attachment[] = [];
		const replaced: Attachment[] = [];
		for (const candidate of candidates) {
			const rivalIndex = live.findIndex(
				(attachment, index) => !supersededLive[index] && isSameAttachmentFile(candidate, attachment)
			);
			const rival = rivalIndex === -1 ? undefined : live[rivalIndex];
			if (!rival) {
				adopted.push(candidate);
				continue;
			}
			if (attachmentProgressRank(candidate) >= attachmentProgressRank(rival)) {
				supersededLive[rivalIndex] = true;
				this.drop(rival);
				replaced.push(rival);
				adopted.push(candidate);
			} else {
				this.drop(candidate);
				replaced.push(candidate);
			}
		}

		this.setList(key, [...adopted, ...live.filter((_, index) => !supersededLive[index])]);
		this.persist(key);
		this.releaseAbandoned(replaced);
	}

	private merge(snapshot: Attachment[], current: Attachment[]): Attachment[] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this call
		const currentByIdentity = new Map(
			current.map((attachment) => [attachmentIdentity(attachment), attachment])
		);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this call
		const included = new Set<string>();
		const merged: Attachment[] = [];
		for (const attachment of snapshot) {
			const identity = attachmentIdentity(attachment);
			if (included.has(identity)) continue;
			included.add(identity);
			merged.push(currentByIdentity.get(identity) ?? this.withoutRevokedPreview(attachment));
		}
		for (const attachment of current) {
			const identity = attachmentIdentity(attachment);
			if (included.has(identity)) continue;
			included.add(identity);
			merged.push(attachment);
		}
		return merged;
	}

	private withoutRevokedPreview(attachment: Attachment): Attachment {
		return 'preview' in attachment && attachment.preview?.startsWith('blob:')
			? this.copy(attachment, { ...attachment, preview: undefined })
			: attachment;
	}

	private createTransfer(
		view: AttachmentView,
		config: UploadConfig,
		attachment: Attachment,
		payload: {
			key: string;
			blob: File | Blob;
			filename: string;
			mimeType: string;
			dimensions?: { width: number; height: number };
			measureImageDimensions?: boolean;
		}
	): AttachmentTransfer {
		const owner: ResultOwner = { release: config.release, released: new SvelteSet() };
		this.owners.set(attachment, owner);
		const registry = view.activeUploads;
		const profile = uploadProfileOf(config);
		const transfer: AttachmentTransfer = new AttachmentTransfer({
			...payload,
			accessKey: config.getAccessKey?.(),
			upload: config.upload ? config.upload : directUpload(config),
			checkPayload: (checked) => checkPayload(profile, config, checked, payload.filename),
			release: (result) => this.releaseThrough(owner, result),
			onSnapshot: (snapshot) => {
				if (this.transfers.get(payload.key) !== transfer) return;
				if (snapshot.phase === 'preprocessing') return;
				this.applyTransferSnapshot(snapshot);
				if (snapshot.phase === 'success') this.transfers.delete(payload.key);
			},
			onActivityChange: (active) => {
				if (active) registry?.claim(transfer);
				else registry?.release(transfer);
			},
			// The tile shows a translated cause; the log adds the code and HTTP status
			// that tell failures apart. The message and `cause` stay out: they carry
			// the storage or Convex response, which can quote the file or the user.
			onAttemptError: (error) =>
				logSafeDiagnostic('error', '[ComposerAttachmentCoordinator] Upload failed', {
					code:
						error instanceof UploadError && Object.hasOwn(LOGGED_UPLOAD_CODES, error.code)
							? error.code
							: 'unclassified',
					status: error instanceof UploadError ? error.status : undefined
				})
		});
		this.transfers.set(payload.key, transfer);
		return transfer;
	}

	/** Drop an attachment whose preparation failed and tell the user why. */
	private settleRefusedStart(
		config: UploadConfig,
		key: string,
		name: string,
		result: AttachmentTransferResult,
		onRefused?: ComposerUploadFileOptions['onPreprocessFailed']
	): void {
		if (result.status !== 'preprocess-failed') return;
		const stillPresent = this.findAttachment(key) !== undefined;
		this.discardAttachment(key);
		if (isAttachmentTransferAbort(result.error) || !stillPresent) return;
		if (onRefused) {
			onRefused(name, result.error instanceof AttachmentRefusal ? result.error : undefined);
			return;
		}
		if (result.error instanceof AttachmentRefusal) {
			const { message, description } = result.error;
			if (description) toast.error(message, { description });
			else toast.error(message);
			return;
		}
		toast.error(
			config.translate?.('chat.error.upload_failed', { filename: name }) ??
				`Failed to upload "${name}"`
		);
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

	/** Rewrite every entry which contains this transfer identity. */
	private rewriteLists(key: string, rewrite: (list: Attachment[]) => Attachment[]): void {
		const rewritten: ConversationKey[] = [];
		for (const [entry, list] of this.lists) {
			if (!list.some((attachment) => transferKeyOf(attachment) === key)) continue;
			rewritten.push(entry);
			this.setList(entry, rewrite(list));
		}
		this.persist(...rewritten);
	}

	private findAttachment(key: string): Attachment | undefined {
		for (const list of this.lists.values()) {
			const found = list.find((attachment) => transferKeyOf(attachment) === key);
			if (found) return found;
		}
		return undefined;
	}

	private patchAttachment(key: string, patch: AttachmentSnapshotPatch): void {
		this.rewriteLists(key, (list) =>
			list.map((attachment) =>
				transferKeyOf(attachment) === key
					? this.copy(attachment, { ...attachment, ...patch })
					: attachment
			)
		);
	}

	private discardAttachment(key: string): void {
		const attachment = this.findAttachment(key);
		if (attachment) this.drop(attachment);
		this.rewriteLists(key, (list) => list.filter((candidate) => transferKeyOf(candidate) !== key));
	}
}

function attachmentIdentity(attachment: Attachment): string {
	if ('key' in attachment && attachment.key) return `transfer:${attachment.key}`;
	if (attachment.type === 'file' || attachment.type === 'screenshot') {
		return `upload:${attachment.type}:${attachment.name}:${attachment.size}:${attachment.mimeType}:${attachment.url ?? ''}:${attachment.uploadState?.fileId ?? ''}`;
	}
	return `${attachment.type}:${attachment.url}:${attachment.filename ?? ''}`;
}

function directUpload(config: DirectUploadConfig): AttachmentTransferUpload {
	return (payload, onProgress, signal) =>
		uploadFileWithProgress(
			payload.blob,
			payload.filename,
			onProgress,
			config,
			payload.dimensions,
			signal
		);
}

/** Refuse, in the user's words, a final payload the view's profile does not allow. */
function checkPayload(
	profile: UploadProfile,
	config: UploadConfig,
	payload: AttachmentTransferPayload,
	sourceName: string
): void {
	const refusal = checkUploadPayload(profile, {
		filename: payload.filename,
		mimeType: payload.mimeType,
		size: payload.blob.size
	});
	if (!refusal) return;
	const translate = config.translate;
	if (refusal.reason === 'type') {
		throw new AttachmentRefusal(
			translate?.('chat.error.file_type_not_allowed', { filename: sourceName }) ??
				`File type not allowed: "${sourceName}"`
		);
	}
	throw new AttachmentRefusal(
		translate?.('chat.error.file_too_large', { filename: sourceName }) ??
			`File too large: "${sourceName}"`,
		translate?.('chat.error.file_max_size', { maxSize: refusal.limit.label }) ??
			`Maximum size is ${refusal.limit.label}`
	);
}
