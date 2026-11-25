import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from './_generated/schema';
import { MutationCtx } from './_generated/services';
import previewDev from './previewDev.spec';
import { ensureSeededAdmin } from './seededAdmin';

export default GroupImpl.make(databaseSchema, previewDev).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, previewDev, 'ensurePreviewAdmin', () =>
			Effect.gen(function* () {
				if (process.env.LOCAL_CONVEX_DEV === 'true') {
					return yield* Effect.die(
						new Error(
							'previewDev:ensurePreviewAdmin is for preview deployments only. ' +
								'On a local dev backend the admin is already seeded by ' +
								'localDev:ensureSeededAdmin, then sign in as admin@local.dev.'
						)
					);
				}
				const password = process.env.PREVIEW_ADMIN_PASSWORD?.trim();
				if (!password) {
					return yield* Effect.die(
						new Error(
							'previewDev:ensurePreviewAdmin requires PREVIEW_ADMIN_PASSWORD env var to be set'
						)
					);
				}
				return yield* ensureSeededAdmin(yield* MutationCtx, {
					email: 'admin@preview.dev',
					password,
					name: 'Preview Admin',
					label: 'preview admin user'
				});
			})
		)
	]),
	GroupImpl.finalize
);
