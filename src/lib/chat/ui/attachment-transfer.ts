import * as Cause from 'effect/Cause';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { LatestFiber, type Claim } from '../../effect/client-runtime.js';
import type { UploadPreprocessor } from '../../uploads/transfer.js';
import { UploadError, type UploadErrorCode } from '../../uploads/transfer.js';
import type { Attachment } from '../core/types.js';
import type { AttachmentUploadResult } from '../core/file-uploader.js';

const SETTLED_PROGRESS_RANK = 101;
const FAILED_PROGRESS_RANK = -1;

export type AttachmentDimensions = { width: number; height: number };

export type AttachmentPreprocess = UploadPreprocessor<File | Blob>;

/** The exact post-preprocessing input reused by every transport attempt. */
export type AttachmentTransferPayload = {
	readonly blob: File | Blob;
	readonly filename: string;
	readonly mimeType: string;
	readonly dimensions?: AttachmentDimensions;
	readonly accessKey?: string;
};

export type AttachmentTransferSnapshot = {
	readonly key: string;
	readonly sourceName: string;
	readonly sourceSize: number;
	readonly name: string;
	readonly mimeType: string;
	readonly size: number;
	readonly phase: 'preprocessing' | 'uploading' | 'success' | 'error';
	readonly progress: number;
	readonly dimensions?: AttachmentDimensions;
	readonly fileId?: string;
	readonly url?: string;
	readonly error?: UploadErrorCode;
};

/** `preprocess-failed` also covers a final payload that `checkPayload` refused. */
export type AttachmentTransferResult =
	| { status: 'success' }
	| { status: 'error' }
	| { status: 'invalidated' }
	| { status: 'unavailable' }
	| { status: 'preprocess-failed'; error: unknown };

/**
 * A refusal whose localized text the user is shown, such as an image that
 * stays over the surface's limit. Any other failure gets the generic upload
 * message, so arbitrary error text never reaches the screen.
 */
export class AttachmentRefusal extends Error {
	/** Secondary line, such as the limit that was exceeded. */
	readonly description?: string;

	constructor(message: string, description?: string) {
		super(message);
		this.name = 'AttachmentRefusal';
		this.description = description;
	}
}

/**
 * A surface's transport for one attempt.
 *
 * It owns whatever it creates until it resolves: on failure or abort it cleans
 * up itself. Once it resolves, the result belongs to the composer, which
 * either adopts it or hands it back through `release`.
 */
export type AttachmentTransferUpload = (
	payload: AttachmentTransferPayload,
	onProgress: (progress: number) => void,
	signal: AbortSignal
) => Promise<AttachmentUploadResult>;

export type AttachmentTransferOptions = {
	key: string;
	blob: File | Blob;
	filename: string;
	mimeType: string;
	dimensions?: AttachmentDimensions;
	accessKey?: string;
	upload: AttachmentTransferUpload;
	measureImageDimensions?: boolean;
	readImageDimensions?: (blob: File | Blob) => Promise<AttachmentDimensions>;
	onSnapshot: (snapshot: AttachmentTransferSnapshot) => void;
	onActivityChange?: (active: boolean) => void;
	onAttemptError?: (error: unknown) => void;
	/**
	 * Throws to refuse the final payload before the first attempt, so a refused
	 * payload never reaches `upload`. Retries reuse the payload it accepted.
	 */
	checkPayload?: (payload: AttachmentTransferPayload) => void;
	/** Receives a successful result whose attempt was invalidated before it could publish. */
	release?: (result: AttachmentUploadResult) => void;
};

/** A canceled transport, which should stay silent in attachment UI. */
export function isAttachmentTransferAbort(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

/** Both names by which a picked file remains identifiable after preprocessing. */
export function attachmentFileIdentity(attachment: Attachment): string[] {
	if (attachment.type !== 'file' && attachment.type !== 'screenshot') return [];
	const identities = [`${attachment.name}:${attachment.size}`];
	if (attachment.sourceName !== undefined && attachment.sourceSize !== undefined) {
		identities.push(`${attachment.sourceName}:${attachment.sourceSize}`);
	}
	return identities;
}

export function isSameAttachmentFile(a: Attachment, b: Attachment): boolean {
	const other = attachmentFileIdentity(b);
	return attachmentFileIdentity(a).some((identity) => other.includes(identity));
}

/** A stored success wins over progress, which wins over a retryable failure. */
export function attachmentProgressRank(attachment: Attachment): number {
	const state = 'uploadState' in attachment ? attachment.uploadState : undefined;
	if (!state || state.status === 'success') return SETTLED_PROGRESS_RANK;
	if (state.status === 'error') return FAILED_PROGRESS_RANK;
	return state.progress;
}

/** Whether persistence has every reference needed to restore the attachment. */
export function isStoredAttachment(attachment: Attachment): boolean {
	if (!('uploadState' in attachment)) return false;
	const state = attachment.uploadState;
	return state?.status === 'success' && !!state.fileId && !!attachment.url;
}

/** Revoke only local object URLs; uploaded and remote URLs remain usable. */
export function revokeAttachmentPreview(
	attachment: Attachment,
	revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)
): void {
	if ('preview' in attachment && attachment.preview?.startsWith('blob:')) {
		revoke(attachment.preview);
	}
}

function readImageDimensions(blob: File | Blob): Promise<AttachmentDimensions> {
	return new Promise((resolve) => {
		const image = new Image();
		const preview = URL.createObjectURL(blob);
		const finish = (dimensions: AttachmentDimensions) => {
			URL.revokeObjectURL(preview);
			resolve(dimensions);
		};
		image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
		image.onerror = () => finish({ width: 0, height: 0 });
		image.src = preview;
	});
}

type Empty = Record<never, never>;

type TransferState = Data.TaggedEnum<{
	Idle: { readonly source: File | Blob };
	Preprocessing: Empty;
	Preparing: Empty;
	Uploading: {
		readonly attempt: number;
		readonly payload: AttachmentTransferPayload;
		readonly progress: number;
	};
	Aborted: { readonly attempt: number; readonly payload: AttachmentTransferPayload };
	Failed: {
		readonly attempt: number;
		readonly payload: AttachmentTransferPayload;
		readonly error: UploadErrorCode;
	};
	Faulted: { readonly error: UploadErrorCode };
	Succeeded: { readonly fileId: string; readonly url?: string };
	Refused: Empty;
	Disposed: Empty;
}>;

const TransferState = Data.taggedEnum<TransferState>();

type TransferView = Pick<
	AttachmentTransferSnapshot,
	'phase' | 'progress' | 'fileId' | 'url' | 'error'
>;

const viewOf = (state: TransferState): TransferView | undefined =>
	TransferState.$match(state, {
		Idle: () => undefined,
		Preprocessing: () => ({ phase: 'preprocessing', progress: 0 }) satisfies TransferView,
		Preparing: () => ({ phase: 'uploading', progress: 0 }) satisfies TransferView,
		Uploading: ({ progress }) => ({ phase: 'uploading', progress }) satisfies TransferView,
		Aborted: () => undefined,
		Failed: ({ error }) => ({ phase: 'error', progress: 0, error }) satisfies TransferView,
		Faulted: ({ error }) => ({ phase: 'error', progress: 0, error }) satisfies TransferView,
		Succeeded: ({ fileId, url }) =>
			({ phase: 'success', progress: 100, fileId, url }) satisfies TransferView,
		Refused: () => undefined,
		Disposed: () => undefined
	});

const isActive = (state: TransferState): boolean =>
	state._tag === 'Preprocessing' || state._tag === 'Preparing' || state._tag === 'Uploading';

const unavailable = (): AttachmentTransferResult => ({ status: 'unavailable' });
const invalidated = (): AttachmentTransferResult => ({ status: 'invalidated' });

/**
 * Owns one attachment's preprocessing and transport attempts.
 *
 * Composer collection, parking, persistence, and rendered attachment state stay
 * with ComposerAttachmentCoordinator; it receives only snapshots from this lifecycle claim.
 */
export class AttachmentTransfer {
	readonly key: string;
	readonly sourceName: string;
	readonly sourceSize: number;

	private name: string;
	private mimeType: string;
	private size: number;
	private dimensions?: AttachmentDimensions;
	private readonly accessKey?: string;
	private readonly upload: AttachmentTransferUpload;
	private readonly shouldMeasureImage: boolean;
	private readonly measureImage: (blob: File | Blob) => Promise<AttachmentDimensions>;
	private readonly onSnapshot: (snapshot: AttachmentTransferSnapshot) => void;
	private readonly onActivityChange?: (active: boolean) => void;
	private readonly onAttemptError?: (error: unknown) => void;
	private readonly checkPayload?: (payload: AttachmentTransferPayload) => void;
	private readonly release?: (result: AttachmentUploadResult) => void;

	private state: TransferState;
	private reportedActive = false;
	private controller: AbortController | undefined;
	private readonly fibers = new LatestFiber<AttachmentTransferResult>(() => {
		this.controller?.abort();
		this.controller = undefined;
	});

	constructor(options: AttachmentTransferOptions) {
		this.key = options.key;
		this.sourceName = options.filename;
		this.sourceSize = options.blob.size;
		this.state = TransferState.Idle({ source: options.blob });
		this.name = options.filename;
		this.mimeType = options.mimeType;
		this.size = options.blob.size;
		this.dimensions = options.dimensions;
		this.accessKey = options.accessKey;
		this.upload = options.upload;
		this.shouldMeasureImage = options.measureImageDimensions ?? true;
		this.measureImage = options.readImageDimensions ?? readImageDimensions;
		this.onSnapshot = options.onSnapshot;
		this.onActivityChange = options.onActivityChange;
		this.onAttemptError = options.onAttemptError;
		this.checkPayload = options.checkPayload;
		this.release = options.release;
	}

	/** Start preprocessing and the first transport attempt exactly once. */
	async start(preprocess?: AttachmentPreprocess): Promise<AttachmentTransferResult> {
		const state = this.state;
		if (state._tag !== 'Idle') return unavailable();
		return await this.fibers.run(
			(claim) => this.begin(claim, state.source, preprocess),
			invalidated
		);
	}

	/** Supersede any current attempt and retry the exact retained payload. */
	async retry(): Promise<AttachmentTransferResult> {
		const state = this.state;
		if (state._tag !== 'Uploading' && state._tag !== 'Aborted' && state._tag !== 'Failed') {
			return unavailable();
		}
		return await this.fibers.run(
			(claim) => this.attempt(claim, state.payload, state.attempt + 1),
			invalidated
		);
	}

	/** Permanently invalidate preprocessing/attempts and release transfer-owned bytes. */
	dispose(): void {
		if (this.state._tag === 'Disposed') return;
		this.state = TransferState.Disposed();
		this.fibers.close();
		this.report(false);
	}

	private begin(
		claim: Claim,
		source: File | Blob,
		preprocess?: AttachmentPreprocess
	): Effect.Effect<AttachmentTransferResult> {
		return Effect.sync(() =>
			this.write(claim, preprocess ? TransferState.Preprocessing() : TransferState.Preparing())
		).pipe(
			Effect.andThen(() =>
				this.prepare(claim, source, preprocess).pipe(
					Effect.flatMap((payload) => this.attempt(claim, payload, 1)),
					Effect.catchCause((cause) =>
						Cause.hasInterruptsOnly(cause)
							? Effect.interrupt
							: this.fibers.settle(Effect.sync(() => this.refuse(claim, Cause.squash(cause))))
					)
				)
			)
		);
	}

	private prepare(
		claim: Claim,
		source: File | Blob,
		preprocess?: AttachmentPreprocess
	): Effect.Effect<AttachmentTransferPayload, unknown> {
		return Effect.gen({ self: this }, function* () {
			let blob = source;
			let dimensions = this.dimensions;

			if (preprocess) {
				const processed = yield* claim.wait(fromPromise(() => preprocess(blob)));
				yield* this.fibers.guard(claim);
				blob = processed.blob;
				this.name = processed.filename ?? this.name;
				this.mimeType = processed.mimeType;
				this.size = blob.size;
				const width = processed.width;
				const height = processed.height;
				dimensions = width && height ? { width, height } : undefined;
				this.dimensions = dimensions;
				yield* Effect.sync(() => this.write(claim, TransferState.Preparing()));

				if (this.mimeType.startsWith('image/') && (width === undefined || height === undefined)) {
					const measured = yield* claim.wait(fromPromise(() => this.measureImage(blob)));
					yield* this.fibers.guard(claim);
					if (measured.width > 0 && measured.height > 0) dimensions = measured;
				}
			} else if (
				this.shouldMeasureImage &&
				this.mimeType.startsWith('image/') &&
				dimensions === undefined
			) {
				const measured = yield* claim.wait(fromPromise(() => this.measureImage(blob)));
				yield* this.fibers.guard(claim);
				if (measured.width > 0 && measured.height > 0) dimensions = measured;
			}

			yield* this.fibers.guard(claim);
			this.dimensions = dimensions;
			const payload: AttachmentTransferPayload = {
				blob,
				filename: this.name,
				mimeType: this.mimeType,
				dimensions,
				accessKey: this.accessKey
			};
			yield* Effect.try({ try: () => this.checkPayload?.(payload), catch: (error) => error });
			return payload;
		});
	}

	private attempt(
		claim: Claim,
		payload: AttachmentTransferPayload,
		attempt: number
	): Effect.Effect<AttachmentTransferResult> {
		return Effect.sync(() =>
			this.write(claim, TransferState.Uploading({ attempt, payload, progress: 0 }))
		).pipe(
			Effect.andThen(this.fibers.guard(claim)),
			Effect.andThen(() => claim.wait(this.transport(claim, payload))),
			Effect.matchEffect({
				onSuccess: (result) =>
					this.fibers.settle(
						Effect.sync(() =>
							this.finish(claim, () => this.succeed(claim, payload, attempt, result))
						)
					),
				onFailure: (error) =>
					this.fibers.settle(
						Effect.sync(() =>
							this.finish(claim, () => this.fail(claim, payload, attempt, error, true))
						)
					)
			})
		);
	}

	private finish(claim: Claim, step: () => AttachmentTransferResult): AttachmentTransferResult {
		try {
			return step();
		} finally {
			if (this.fibers.owns(claim)) {
				this.controller = undefined;
				this.report(false);
			}
		}
	}

	private succeed(
		claim: Claim,
		payload: AttachmentTransferPayload,
		attempt: number,
		result: AttachmentUploadResult
	): AttachmentTransferResult {
		try {
			if (!this.fibers.owns(claim)) {
				this.release?.(result);
				return invalidated();
			}
			this.write(claim, TransferState.Succeeded({ fileId: result.fileId, url: result.url }));
			return { status: 'success' };
		} catch (error) {
			return this.fail(claim, payload, attempt, error, false);
		}
	}

	private fail(
		claim: Claim,
		payload: AttachmentTransferPayload,
		attempt: number,
		error: unknown,
		retryable: boolean
	): AttachmentTransferResult {
		if (!this.fibers.owns(claim)) return invalidated();
		if (isAttachmentTransferAbort(error)) {
			if (retryable) this.state = TransferState.Aborted({ attempt, payload });
			return invalidated();
		}
		this.onAttemptError?.(error);
		const code = error instanceof UploadError ? error.code : 'server';
		this.write(
			claim,
			retryable
				? TransferState.Failed({ attempt, payload, error: code })
				: TransferState.Faulted({ error: code })
		);
		return { status: 'error' };
	}

	private refuse(claim: Claim, error: unknown): AttachmentTransferResult {
		if (!this.fibers.owns(claim)) return invalidated();
		this.state = TransferState.Refused();
		this.report(false);
		return { status: 'preprocess-failed', error };
	}

	private transport(
		claim: Claim,
		payload: AttachmentTransferPayload
	): Effect.Effect<AttachmentUploadResult, unknown> {
		return Effect.callback<AttachmentUploadResult, unknown>((resume) => {
			const controller = new AbortController();
			this.controller = controller;
			let pending: Promise<AttachmentUploadResult>;
			try {
				pending = this.upload(
					payload,
					(progress) => this.progress(claim, controller, progress),
					controller.signal
				);
			} catch (error) {
				resume(Effect.fail(error));
				return;
			}
			pending.then(
				(result) => resume(Effect.succeed(result)),
				(error: unknown) => resume(Effect.fail(error))
			);
			return Effect.sync(() => {
				controller.abort();
				pending.then((result) => this.release?.(result)).catch(() => {});
			});
		});
	}

	private progress(claim: Claim, controller: AbortController, progress: number): void {
		const state = this.state;
		if (this.controller !== controller || state._tag !== 'Uploading') return;
		this.write(claim, TransferState.Uploading({ ...state, progress }));
	}

	private write(claim: Claim, next: TransferState): void {
		if (!this.fibers.owns(claim)) return;
		this.state = next;
		if (isActive(next)) this.report(true);
		if (!this.fibers.owns(claim)) return;
		const view = viewOf(next);
		if (!view) return;
		this.onSnapshot({
			key: this.key,
			sourceName: this.sourceName,
			sourceSize: this.sourceSize,
			name: this.name,
			mimeType: this.mimeType,
			size: this.size,
			dimensions: this.dimensions,
			...view
		});
	}

	private report(active: boolean): void {
		if (this.reportedActive === active) return;
		this.reportedActive = active;
		this.onActivityChange?.(active);
	}
}

const fromPromise = <A>(run: () => Promise<A>): Effect.Effect<A, unknown> =>
	Effect.tryPromise({ try: run, catch: (error) => error });
