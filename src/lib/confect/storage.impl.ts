import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { components } from '../convex/_generated/api';
import type { MutationCtx as ConvexMutationCtx } from '../convex/_generated/server';
import databaseSchema from './_generated/schema';
import { MutationCtx } from './_generated/services';
import { PROFILE_IMAGE_ALLOWED_TYPES, PROFILE_IMAGE_MAX_SIZE } from './constants';
import { FileRefusal } from './errorCodecs';
import { FILE_ERROR_CODES } from './files/errors';
import RequireUserImpl from './middleware/RequireUser.impl';
import { CurrentUser } from './middleware/RequireUser.spec';
import { appRateLimiter } from './rateLimit';
import storage from './storage.spec';
import { RateLimited } from '../effect/errors';

const limitUser = (ctx: ConvexMutationCtx, name: 'profileImageUpload' | 'profileImageUpdate') =>
	Effect.gen(function* () {
		const { _id: key } = yield* CurrentUser;
		const status = yield* Effect.promise(() => appRateLimiter.limit(ctx, name, { key }));
		if (!status.ok) return yield* Effect.fail(new RateLimited({ retryAfter: status.retryAfter }));
		return key;
	});

const rejectUpload = (ctx: ConvexMutationCtx, storageId: string, refusal: FileRefusal) =>
	Effect.promise(() =>
		ctx.runMutation(components.convexFilesControl.cleanUp.deleteFile, { storageId })
	).pipe(Effect.andThen(Effect.fail(refusal)));

export default GroupImpl.make(databaseSchema, storage).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, storage, 'generateUploadUrl', () =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				yield* limitUser(ctx, 'profileImageUpload');
				return yield* Effect.promise(() =>
					ctx.runMutation(components.convexFilesControl.upload.generateUploadUrl, {
						provider: 'convex'
					})
				);
			})
		),
		FunctionImpl.make(databaseSchema, storage, 'updateProfileImage', ({ storageId, uploadToken }) =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const userId = yield* limitUser(ctx, 'profileImageUpdate');
				const { metadata } = yield* Effect.promise(() =>
					ctx.runMutation(components.convexFilesControl.upload.finalizeUpload, {
						uploadToken,
						storageId,
						accessKeys: [userId],
						expiresAt: null
					})
				);
				if (!metadata?.contentType || !PROFILE_IMAGE_ALLOWED_TYPES.includes(metadata.contentType)) {
					return yield* rejectUpload(
						ctx,
						storageId,
						new FileRefusal({
							refusal: {
								code: FILE_ERROR_CODES.typeNotAllowed,
								allowedTypes: PROFILE_IMAGE_ALLOWED_TYPES
							}
						})
					);
				}
				if (metadata.size > PROFILE_IMAGE_MAX_SIZE) {
					return yield* rejectUpload(
						ctx,
						storageId,
						new FileRefusal({
							refusal: {
								code: FILE_ERROR_CODES.tooLarge,
								maxBytes: PROFILE_IMAGE_MAX_SIZE,
								actualBytes: metadata.size
							}
						})
					);
				}
				const grant = yield* Effect.promise(() =>
					ctx.runMutation(components.convexFilesControl.download.createDownloadGrant, {
						storageId,
						maxUses: null,
						expiresAt: null,
						shareableLink: true
					})
				);
				const siteUrl = process.env.CONVEX_SITE_URL;
				if (!siteUrl) {
					return yield* Effect.fail(
						new FileRefusal({ refusal: { code: FILE_ERROR_CODES.storageUnavailable } })
					);
				}
				return `${siteUrl}/files/inline?token=${grant.downloadToken}`;
			})
		)
	]),
	Layer.provide(RequireUserImpl),
	GroupImpl.finalize
);
