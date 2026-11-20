/**
 * Capability type tests for the Confect handlers, checked by `bun run check:convex`.
 * Every `@ts-expect-error` must hold an error, so a capability that leaks into
 * the wrong kind fails the check as an unused directive. The second dot in the
 * file name keeps Convex from deploying it.
 */
import { FunctionSpec, GroupSpec } from '@confect/core';
import { FunctionImpl, Scheduler } from '@confect/server';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { CurrentUser, RequireAdmin, RequireUser } from '../confect/auth';
import databaseSchema from '../confect/schema';
import { DatabaseReader, DatabaseWriter } from '../confect/services';

const spec = GroupSpec.make()
	.addFunction(FunctionSpec.publicQuery({ name: 'q', returns: () => Schema.Null }))
	.addFunction(FunctionSpec.publicAction({ name: 'a', returns: () => Schema.Null }))
	.addFunction(
		FunctionSpec.publicQuery({ name: 'authed', returns: () => Schema.String }).middleware(
			RequireUser
		)
	)
	.addFunction(
		FunctionSpec.publicMutation({ name: 'admin', returns: () => Schema.String }).middleware(
			RequireAdmin
		)
	);

const writes = Effect.gen(function* () {
	const writer = yield* DatabaseWriter;
	yield* writer.table('messages').insert({ userId: 'u', body: 'b' });
	return null;
}).pipe(Effect.orDie);
const schedules = Effect.gen(function* () {
	yield* Scheduler.Scheduler;
	return null;
});
const reads = Effect.gen(function* () {
	yield* DatabaseReader;
	return null;
});
const userEmail = CurrentUser.useSync((user) => user.email);

// A query cannot write.
// @ts-expect-error DatabaseWriter is not a query service
export const queryWrites = FunctionImpl.make(databaseSchema, spec, 'q', () => writes);

// A query cannot schedule.
// @ts-expect-error Scheduler is not a query service
export const querySchedules = FunctionImpl.make(databaseSchema, spec, 'q', () => schedules);

// An action has no database.
// @ts-expect-error DatabaseReader is not an action service
export const actionReads = FunctionImpl.make(databaseSchema, spec, 'a', () => reads);

// A function without the auth middleware has no signed-in user.
// @ts-expect-error CurrentUser comes only from RequireUser or RequireAdmin
export const queryUser = FunctionImpl.make(databaseSchema, spec, 'q', () => userEmail);

// An undeclared failure does not compile.
class Undeclared extends Data.TaggedError('Undeclared')<{ readonly code: 'X' }> {}
const fails = () => Effect.fail(new Undeclared({ code: 'X' }));
// @ts-expect-error the handler fails with an error the spec does not declare
export const undeclared = FunctionImpl.make(databaseSchema, spec, 'q', fails);

// CurrentUser is inferred as the Better Auth user under both middlewares.
export const authedUser = FunctionImpl.make(databaseSchema, spec, 'authed', () => userEmail);
export const adminUser = FunctionImpl.make(databaseSchema, spec, 'admin', () =>
	Effect.gen(function* () {
		const user = yield* CurrentUser;
		const role: string | null | undefined = user.role;
		return `${user.email}:${role ?? 'user'}`;
	})
);
