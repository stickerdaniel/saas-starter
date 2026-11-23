import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { QueryCtx } from '../_generated/services';
import RequireAdminImpl from '../middleware/RequireAdmin.impl';
import {
	countMatchingUsers,
	findUsersLastPage,
	readDashboardMetrics,
	readUsersPage
} from './queries';
import queries from './queries.spec';

export default GroupImpl.make(databaseSchema, queries).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, queries, 'getDashboardMetrics', () =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				const now = yield* Clock.currentTimeMillis;
				return yield* Effect.promise(() => readDashboardMetrics(ctx, now));
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'getUserCount', (args) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => countMatchingUsers(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'listUsers', (args) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => readUsersPage(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'resolveUsersLastPage', (args) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => findUsersLastPage(ctx, args));
			})
		)
	]),
	Layer.provide(RequireAdminImpl),
	GroupImpl.finalize
);
