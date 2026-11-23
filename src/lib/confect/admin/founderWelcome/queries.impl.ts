import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import { QueryCtx } from '../../_generated/services';
import RequireAdminImpl from '../../middleware/RequireAdmin.impl';
import { CurrentUser } from '../../middleware/RequireUser.spec';
import {
	readFounderEmailSettings,
	readFounderWelcomeAdminConfig,
	readFounderWelcomeConfig
} from './queries';
import queries from './queries.spec';

export default GroupImpl.make(databaseSchema, queries).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, queries, 'getFounderEmailSettings', () =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				const viewer = yield* CurrentUser;
				return yield* Effect.promise(() => readFounderEmailSettings(ctx, viewer._id));
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'getFounderWelcomeConfig', () =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				const viewer = yield* CurrentUser;
				return yield* Effect.promise(() => readFounderWelcomeAdminConfig(ctx, viewer._id));
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'getFounderWelcomeConfigInternal', () =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => readFounderWelcomeConfig(ctx));
			})
		)
	]),
	Layer.provide(RequireAdminImpl),
	GroupImpl.finalize
);
