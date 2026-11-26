import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { components } from '../convex/_generated/api';
import databaseSchema from './_generated/schema';
import { MutationCtx } from './_generated/services';
import { FileRefusal } from './errorCodecs';
import { FILE_ERROR_CODES } from './files/errors';
import { presignedUploadRefusal } from './files/upload';
import RequireUserImpl from './middleware/RequireUser.impl';
import { CurrentUser } from './middleware/RequireUser.spec';
import { appRateLimiter } from './rateLimit';
import storage from './storage.spec';
import { RateLimited } from '../effect/errors';

export default GroupImpl.make(databaseSchema, storage).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, storage, 'authorizeUpload', () =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				const { _id: key } = yield* CurrentUser;
				const status = yield* Effect.promise(() =>
					appRateLimiter.limit(ctx, 'profileImageUpload', { key })
				);
				if (!status.ok) {
					return yield* Effect.fail(new RateLimited({ retryAfter: status.retryAfter }));
				}
				return key;
			})
		),
		FunctionImpl.make(
			databaseSchema,
			storage,
			'finalizeProfileImage',
			({ storageId, uploadToken }) =>
				Effect.gen(function* () {
					const ctx = yield* MutationCtx;
					const { _id: userId } = yield* CurrentUser;
					yield* Effect.promise(() =>
						ctx.runMutation(components.convexFilesControl.upload.finalizeUpload, {
							uploadToken,
							storageId,
							accessKeys: [userId],
							expiresAt: null
						})
					);
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
		),
		FunctionImpl.make(databaseSchema, storage, 'generateUploadUrl', () =>
			Effect.gen(function* () {
				return yield* presignedUploadRefusal;
			})
		),
		FunctionImpl.make(databaseSchema, storage, 'updateProfileImage', () =>
			Effect.gen(function* () {
				return yield* presignedUploadRefusal;
			})
		)
	]),
	Layer.provide(RequireUserImpl),
	GroupImpl.finalize
);
