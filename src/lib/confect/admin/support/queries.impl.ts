import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import RequireAdminImpl from '../../middleware/RequireAdmin.impl';
import {
	countAwaitingResponse,
	readAdmins,
	readInternalNotes,
	readMessageRoutes,
	readMessages,
	readThreadDetails,
	readThreadsPage
} from './queries';
import queries from './queries.spec';

export default GroupImpl.make(databaseSchema, queries).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, queries, 'getAwaitingResponseCount', () =>
			Effect.gen(function* () {
				return yield* countAwaitingResponse;
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'getThreadForAdmin', (args) =>
			Effect.gen(function* () {
				return yield* readThreadDetails(args);
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'listAdmins', () =>
			Effect.gen(function* () {
				return yield* readAdmins;
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'listInternalUserNotes', (args) =>
			Effect.gen(function* () {
				return yield* readInternalNotes(args);
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'listMessageRoutesForAdmin', (args) =>
			Effect.gen(function* () {
				return yield* readMessageRoutes(args);
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'listMessagesForAdmin', (args) =>
			Effect.gen(function* () {
				return yield* readMessages(args);
			})
		),
		FunctionImpl.make(databaseSchema, queries, 'listThreadsForAdmin', (args) =>
			Effect.gen(function* () {
				return yield* readThreadsPage(args);
			})
		)
	]),
	Layer.provide(RequireAdminImpl),
	GroupImpl.finalize
);
