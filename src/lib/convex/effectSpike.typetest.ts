/**
 * Capability type tests for the Effect builders, checked by `bun run check:convex`.
 * Every `@ts-expect-error` must hold an error, so a capability that leaks into
 * the wrong kind fails the check as an unused directive. The second dot in the
 * file name keeps Convex from deploying it.
 */
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import {
	call,
	ConvexScheduler,
	DatabaseReader,
	DatabaseWriter,
	effectInternalAction,
	effectInternalQuery
} from './effect';
import { CurrentUser, effectAdminMutation, effectAuthedQuery } from './effectAuth';

const writes = () =>
	call(DatabaseWriter, (db) => db.delete('messages', 'm' as never)).pipe(Effect.as(null));
const schedules = () =>
	call(ConvexScheduler, (s) =>
		s.runAfter(0, internal.messages.removeMessage, { messageId: 'm' as never })
	).pipe(Effect.as(null));
const reads = () =>
	call(DatabaseReader, (db) => db.query('messages').first()).pipe(Effect.as(null));
const userEmail = () => CurrentUser.useSync((user) => user.email);

// A query cannot write.
// @ts-expect-error DatabaseWriter is not a query service
export const queryWrites = effectInternalQuery({ args: {}, returns: v.null(), handler: writes });

// A query cannot schedule.
// @ts-expect-error ConvexScheduler is not a query service
export const queryRuns = effectInternalQuery({ args: {}, returns: v.null(), handler: schedules });

// An action has no database.
// @ts-expect-error DatabaseReader is not an action service
export const actionReads = effectInternalAction({ args: {}, returns: v.null(), handler: reads });

// A query outside the authed builders has no signed-in user.
// @ts-expect-error CurrentUser exists only in the authed and admin builders
export const queryUser = effectInternalQuery({ args: {}, returns: v.string(), handler: userEmail });

// An undeclared failure does not compile.
class Undeclared extends Data.TaggedError('Undeclared')<{ readonly code: 'X' }> {}
const fails = () => Effect.fail(new Undeclared({ code: 'X' }));
// @ts-expect-error the handler fails with an error outside `errors`
export const undeclared = effectInternalQuery({ args: {}, returns: v.null(), handler: fails });

// CurrentUser is inferred as the Better Auth user in the authed and admin builders.
export const authedUser = effectAuthedQuery({ args: {}, returns: v.string(), handler: userEmail });
export const adminUser = effectAdminMutation({
	args: {},
	returns: v.string(),
	handler: () =>
		Effect.gen(function* () {
			const user = yield* CurrentUser;
			const role: string | null | undefined = user.role;
			return `${user.email}:${role ?? 'user'}`;
		})
});
