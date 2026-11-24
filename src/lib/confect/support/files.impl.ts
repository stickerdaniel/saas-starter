import { FunctionImpl, GroupImpl } from '@confect/server';
import { storeFile } from '@convex-dev/agent';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import { components, internal } from '../../convex/_generated/api';
import type {
	ActionCtx as ConvexActionCtx,
	MutationCtx as ConvexMutationCtx
} from '../../convex/_generated/server';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { ActionCtx, MutationCtx, MutationRunner } from '../_generated/services';
import { RateLimited } from '../../effect/errors';
import { fetchAttachmentText } from '../files/attachmentText';
import { FILE_ERROR_CODES, createFileError } from '../files/errors';
import { releaseUploadStaging, UPLOAD_STAGING_TTL_MS } from '../files/staging';
import { validateUploadBlob } from '../files/upload';
import VisitorAccessImpl from '../middleware/VisitorAccess.impl';
import { SupportOwner } from '../middleware/VisitorAccess.spec';
import files from './files.spec';
import { ANONYMOUS_GLOBAL_RATE_LIMIT_KEY, supportRateLimiter } from './rateLimit';
import type { UploadRegistrationArgsSchema } from './schemas';

type OwnerBuckets = {
	readonly anonymous: 'supportFileUploadAnon' | 'supportFilePreviewAnon';
	readonly signedIn: 'supportFileUpload' | 'supportFilePreview';
};

const limitOwner = (ctx: ConvexMutationCtx, buckets: OwnerBuckets) =>
	Effect.gen(function* () {
		const owner = yield* SupportOwner;
		const shared = { name: buckets.anonymous, key: ANONYMOUS_GLOBAL_RATE_LIMIT_KEY };
		const { name, key } = Option.match(owner, {
			onNone: () => shared,
			onSome: (identity) =>
				identity.isAnonymous ? shared : { name: buckets.signedIn, key: identity.ownerId }
		});
		const status = yield* Effect.promise(() => supportRateLimiter.limit(ctx, name, { key }));
		if (!status.ok) return yield* Effect.fail(new RateLimited({ retryAfter: status.retryAfter }));
	});

async function registerUpload(
	ctx: ConvexActionCtx,
	args: typeof UploadRegistrationArgsSchema.Type
) {
	const accessKey = args.accessKey?.trim() || 'support';
	await ctx.runMutation(components.convexFilesControl.upload.finalizeUpload, {
		uploadToken: args.uploadToken,
		storageId: args.storageId,
		accessKeys: [accessKey],
		expiresAt: Date.now() + UPLOAD_STAGING_TTL_MS
	});

	try {
		const downloadGrant = await ctx.runMutation(
			components.convexFilesControl.download.createDownloadGrant,
			{
				storageId: args.storageId,
				maxUses: 1,
				expiresAt: Date.now() + 5 * 60 * 1000,
				shareableLink: false
			}
		);

		const downloadResult = await ctx.runMutation(
			components.convexFilesControl.download.consumeDownloadGrantForUrl,
			{
				downloadToken: downloadGrant.downloadToken,
				accessKey
			}
		);

		if (downloadResult.status !== 'ok' || !downloadResult.downloadUrl) {
			throw new Error(`Failed to get download URL: ${downloadResult.status}`);
		}

		const response = await fetch(downloadResult.downloadUrl);
		if (!response.ok) {
			throw createFileError(FILE_ERROR_CODES.fetchFailed);
		}
		const blob = await response.blob();
		const verifiedMimeType = validateUploadBlob(blob, args.locale);

		const { file } = await storeFile(ctx, components.agent, blob, {
			filename: args.filename
		});

		if (args.width && args.height && verifiedMimeType.startsWith('image/')) {
			await ctx.runMutation(internal.files.metadata.storeFileMetadata, {
				fileId: file.fileId,
				storageId: file.storageId,
				url: file.url,
				width: args.width,
				height: args.height
			});
		}

		return {
			fileId: file.fileId,
			storageId: file.storageId,
			url: file.url,
			filename: file.filename,
			isImage: verifiedMimeType.startsWith('image/')
		};
	} finally {
		await releaseUploadStaging(ctx, args.storageId);
	}
}

export default GroupImpl.make(databaseSchema, files).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, files, 'checkPreviewAccess', () =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				yield* limitOwner(ctx, {
					anonymous: 'supportFilePreviewAnon',
					signedIn: 'supportFilePreview'
				});
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, files, 'generateUploadUrl', () =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				yield* limitOwner(ctx, {
					anonymous: 'supportFileUploadAnon',
					signedIn: 'supportFileUpload'
				});
				return yield* Effect.promise(() =>
					ctx.runMutation(components.convexFilesControl.upload.generateUploadUrl, {
						provider: 'convex'
					})
				);
			})
		),
		FunctionImpl.make(
			databaseSchema,
			files,
			'getAttachmentText',
			({ url, anonymousUserId, locale }) =>
				Effect.gen(function* () {
					const mutations = yield* MutationRunner;
					yield* mutations
						.runMutation(refs.internal.support.files.checkPreviewAccess, { anonymousUserId })
						.pipe(Effect.catchTag('SchemaError', Effect.die));
					return yield* Effect.promise(() => fetchAttachmentText(url, locale));
				})
		),
		FunctionImpl.make(databaseSchema, files, 'saveUploadedFile', (args) =>
			Effect.gen(function* () {
				const ctx = yield* ActionCtx;
				return yield* Effect.promise(() => registerUpload(ctx, args));
			})
		)
	]),
	Layer.provide(VisitorAccessImpl),
	GroupImpl.finalize
);
