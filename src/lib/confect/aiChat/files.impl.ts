import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { components } from '../../convex/_generated/api';
import type { MutationCtx as ConvexMutationCtx } from '../../convex/_generated/server';
import refs from '../_generated/refs';
import databaseSchema from '../_generated/schema';
import { ActionCtx, MutationCtx, MutationRunner } from '../_generated/services';
import { FileRefusal } from '../errorCodecs';
import { fetchAttachmentText } from '../files/attachmentText';
import { FILE_ERROR_CODES } from '../files/errors';
import { registerUpload } from '../files/registerUpload';
import RequireUserImpl from '../middleware/RequireUser.impl';
import { CurrentUser } from '../middleware/RequireUser.spec';
import files from './files.spec';
import { aiChatRateLimiter } from './rateLimit';

type FileBucket = {
	readonly name: 'aiChatFileUpload' | 'aiChatFilePreview';
	readonly code:
		typeof FILE_ERROR_CODES.uploadRateLimited | typeof FILE_ERROR_CODES.previewRateLimited;
};

const limitUser = (ctx: ConvexMutationCtx, { name, code }: FileBucket) =>
	Effect.gen(function* () {
		const { _id: key } = yield* CurrentUser;
		const status = yield* Effect.promise(() => aiChatRateLimiter.limit(ctx, name, { key }));
		if (!status.ok) {
			return yield* Effect.fail(
				new FileRefusal({ refusal: { code, retryAfter: status.retryAfter } })
			);
		}
	});

export default GroupImpl.make(databaseSchema, files).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, files, 'checkPreviewAccess', () =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				yield* limitUser(ctx, {
					name: 'aiChatFilePreview',
					code: FILE_ERROR_CODES.previewRateLimited
				});
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, files, 'generateUploadUrl', () =>
			Effect.gen(function* () {
				const ctx = yield* MutationCtx;
				yield* limitUser(ctx, {
					name: 'aiChatFileUpload',
					code: FILE_ERROR_CODES.uploadRateLimited
				});
				return yield* Effect.promise(() =>
					ctx.runMutation(components.convexFilesControl.upload.generateUploadUrl, {
						provider: 'convex'
					})
				);
			})
		),
		FunctionImpl.make(databaseSchema, files, 'getAttachmentText', ({ url, locale }) =>
			Effect.gen(function* () {
				const mutations = yield* MutationRunner;
				yield* mutations
					.runMutation(refs.internal.aiChat.files.checkPreviewAccess, {})
					.pipe(Effect.catchTag('SchemaError', Effect.die));
				return yield* Effect.promise(() => fetchAttachmentText(url, locale));
			})
		),
		FunctionImpl.make(databaseSchema, files, 'requireFileAccess', () =>
			Effect.gen(function* () {
				yield* CurrentUser;
				return null;
			})
		),
		FunctionImpl.make(databaseSchema, files, 'saveUploadedFile', (args) =>
			Effect.gen(function* () {
				const mutations = yield* MutationRunner;
				yield* mutations
					.runMutation(refs.internal.aiChat.files.requireFileAccess, {})
					.pipe(Effect.catchTag('SchemaError', Effect.die));
				const ctx = yield* ActionCtx;
				return yield* Effect.promise(() => registerUpload(ctx, args, 'ai-chat'));
			})
		)
	]),
	Layer.provide(RequireUserImpl),
	GroupImpl.finalize
);
