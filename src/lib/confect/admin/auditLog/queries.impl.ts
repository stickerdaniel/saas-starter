import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import { QueryCtx } from '../../_generated/services';
import RequireAdminImpl from '../../middleware/RequireAdmin.impl';
import {
	countAuditLogs,
	findAuditLogLastPage,
	readAuditLogPage,
	resolveAuditLogUserRef
} from './queries';
import queries from './queries.spec';

export default GroupImpl.make(databaseSchema, queries).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, queries, 'getAuditLogCount', (args) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => countAuditLogs(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'listAuditLogs', (args) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => readAuditLogPage(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'resolveAuditLogLastPage', (args) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => findAuditLogLastPage(ctx, args));
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'resolveAuditLogUser', (args) =>
			Effect.gen(function* () {
				const ctx = yield* QueryCtx;
				return yield* Effect.promise(() => resolveAuditLogUserRef(ctx, args.userId));
			})
		)
	]),
	Layer.provide(RequireAdminImpl),
	GroupImpl.finalize
);
