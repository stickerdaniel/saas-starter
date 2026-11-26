import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import type { MutationCtx as ConvexMutationCtx } from '../../convex/_generated/server';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { MutationCtx, MutationRunner } from '../_generated/services';
import { RateLimited } from '../../effect/errors';
import { SupportRefusal } from '../errorCodecs';
import { SUPPORT_ERROR_CODES } from './errors';
import { fetchAttachmentText } from '../files/attachmentText';
import { presignedUploadRefusal } from '../files/upload';
import VisitorAccessImpl from '../middleware/VisitorAccess.impl';
import { SupportOwner } from '../middleware/VisitorAccess.spec';
import files from './files.spec';
import { ANONYMOUS_GLOBAL_RATE_LIMIT_KEY, supportRateLimiter } from './rateLimit';

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

export default GroupImpl.make(databaseSchema, files).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, files, 'authorizeUpload', () =>
			Effect.gen(function* () {
				const owner = yield* SupportOwner;
				if (Option.isNone(owner)) {
					return yield* Effect.fail(
						new SupportRefusal({
							refusal: { code: SUPPORT_ERROR_CODES.authenticationRequired }
						})
					);
				}
				const ctx = yield* MutationCtx;
				yield* limitOwner(ctx, {
					anonymous: 'supportFileUploadAnon',
					signedIn: 'supportFileUpload'
				});
				return owner.value.ownerId;
			})
		),
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
				return yield* presignedUploadRefusal;
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
		FunctionImpl.make(databaseSchema, files, 'saveUploadedFile', () =>
			Effect.gen(function* () {
				return yield* presignedUploadRefusal;
			})
		)
	]),
	Layer.provide(VisitorAccessImpl),
	GroupImpl.finalize
);
