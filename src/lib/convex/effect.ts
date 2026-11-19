/**
 * Effect builders for Convex functions.
 *
 * Each builder wraps the plain builder of the same kind; `effectAuth.ts` holds
 * the authed and admin ones, so a module that needs neither loads no Better Auth. The handler
 * returns an Effect; `ctx` arrives as services, one per capability of the kind:
 *
 * ```ts
 * export const get = effectAuthedQuery({ // from ./effectAuth
 *   args: {},
 *   returns: v.number(),
 *   handler: () =>
 *     Effect.gen(function* () {
 *       const user = yield* CurrentUser;
 *       const row = yield* call(DatabaseReader, (db) =>
 *         db.query('passkeyNudgeDismissals').withIndex('by_userId', (q) => q.eq('userId', user._id)).unique()
 *       );
 *       return row?.deferredUntil ?? 0;
 *     })
 * });
 * ```
 *
 * Queries and mutations run as one fiber on `syncScheduler()`: Convex rejects
 * timers there, and the default scheduler yields through one after 2,048
 * operations. Queries read time only through an explicit `Clock` call (see
 * `queryClock`). A failure whose class is listed in `errors` leaves as
 * `ConvexError({ code, ...data })`; a defect leaves as the thrown value itself,
 * so a `ConvexError` thrown by called code passes through unchanged.
 */
import * as Cause from 'effect/Cause';
import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import type {
	Auth as ConvexAuth,
	RegisteredAction,
	RegisteredMutation,
	RegisteredQuery,
	Scheduler,
	StorageActionWriter,
	StorageReader as ConvexStorageReader,
	StorageWriter as ConvexStorageWriter
} from 'convex/server';
import {
	ConvexError,
	type GenericValidator,
	type Infer,
	type ObjectType,
	type PropertyValidators,
	type Value
} from 'convex/values';
import { syncScheduler } from '../effect/scheduler';
import {
	internalAction,
	internalMutation,
	internalQuery,
	type ActionCtx,
	type DatabaseReader as ConvexDatabaseReader,
	type DatabaseWriter as ConvexDatabaseWriter,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';

export class DatabaseReader extends Context.Service<DatabaseReader, ConvexDatabaseReader>()(
	'convex/DatabaseReader'
) {}
export class DatabaseWriter extends Context.Service<DatabaseWriter, ConvexDatabaseWriter>()(
	'convex/DatabaseWriter'
) {}
export class Auth extends Context.Service<Auth, ConvexAuth>()('convex/Auth') {}
export class ConvexScheduler extends Context.Service<ConvexScheduler, Scheduler>()(
	'convex/Scheduler'
) {}
export class StorageReader extends Context.Service<StorageReader, ConvexStorageReader>()(
	'convex/StorageReader'
) {}
export class StorageWriter extends Context.Service<StorageWriter, ConvexStorageWriter>()(
	'convex/StorageWriter'
) {}
export class QueryRunner extends Context.Service<QueryRunner, QueryCtx['runQuery']>()(
	'convex/QueryRunner'
) {}
export class MutationRunner extends Context.Service<MutationRunner, MutationCtx['runMutation']>()(
	'convex/MutationRunner'
) {}
export class ActionRunner extends Context.Service<ActionRunner, ActionCtx['runAction']>()(
	'convex/ActionRunner'
) {}

export type QueryServices = DatabaseReader | Auth | StorageReader | QueryRunner;
export type MutationServices =
	QueryServices | DatabaseWriter | ConvexScheduler | StorageWriter | MutationRunner;
export type ActionServices =
	| Auth
	| StorageReader
	| StorageWriter
	| QueryRunner
	| MutationRunner
	| ActionRunner
	| ConvexScheduler;

/**
 * Call one Convex API on a service. A rejection becomes a defect, so a
 * `ConvexError` it throws reaches the client unchanged.
 *
 * ```ts
 * const rows = yield* call(DatabaseReader, (db) => db.query('messages').take(10));
 * ```
 */
export const call = <I, S, A>(
	service: Context.Service<I, S>,
	use: (service: S) => Promise<A>
): Effect.Effect<A, never, I> => service.use((value) => Effect.promise(() => use(value)));

/**
 * A failure a function declares. It reaches the client as
 * `ConvexError({ code, ...data })`, the shape `getConvexErrorCode` reads.
 */
export interface WireError {
	readonly _tag: string;
	readonly code: string;
	readonly data?: Readonly<Record<string, Value>> | undefined;
}

type ErrorClass<E extends WireError> = abstract new (...args: never) => E;

export interface Definition<
	Args extends PropertyValidators,
	Out extends GenericValidator,
	E extends WireError,
	R
> {
	readonly args: Args;
	readonly returns: Out;
	/** The failures that may reach the client; any other failure type is a compile error. */
	readonly errors?: ReadonlyArray<ErrorClass<E>>;
	readonly handler: (args: ObjectType<Args>) => Effect.Effect<Infer<Out>, NoInfer<E>, R>;
}

/**
 * The query `Clock`. Logging, spans and elapsed time read the unsafe accessors,
 * which return constants, so they read no time and leave the query cacheable.
 * `Clock.currentTimeMillis` and the other effectful accessors read `Date.now()`:
 * an explicit time read, which Convex tracks like a plain `Date.now()`.
 */
export const queryClock: Clock.Clock = {
	currentTimeMillisUnsafe: () => 0,
	currentTimeNanosUnsafe: () => 0n,
	monotonicTimeNanosUnsafe: () => 0n,
	currentTimeMillis: Effect.sync(() => Date.now()),
	currentTimeNanos: Effect.sync(() => BigInt(Date.now()) * 1_000_000n),
	monotonicTimeNanos: Effect.sync(() => BigInt(Date.now()) * 1_000_000n),
	sleep: () => Effect.die(new Error('Effect.sleep is not available in a Convex query'))
};

type Kind = 'query' | 'mutation' | 'action';

function thrownValue<E extends WireError>(
	cause: Cause.Cause<E>,
	errors: ReadonlyArray<ErrorClass<E>>
): unknown {
	for (const reason of cause.reasons) {
		if (!Cause.isFailReason(reason)) continue;
		const error = reason.error;
		if (errors.some((declared) => error instanceof declared)) {
			return new ConvexError({ ...error.data, code: error.code });
		}
		return new Error(`Undeclared failure ${error._tag}`);
	}
	for (const reason of cause.reasons) {
		if (Cause.isDieReason(reason)) return reason.defect;
	}
	return new Error('Convex handler interrupted');
}

/**
 * Run a handler's complete program, services already provided, as one root
 * fiber. Queries and mutations pass `syncScheduler()` as the run option, so
 * every auto-yield resumes on a microtask instead of a timer.
 */
export function runConvexHandler<A, E extends WireError>(
	kind: Kind,
	program: Effect.Effect<A, E>,
	errors: ReadonlyArray<ErrorClass<E>>
): Promise<A> {
	return Effect.runPromiseExit(
		program,
		kind === 'action' ? undefined : { scheduler: syncScheduler() }
	).then((exit) => {
		if (Exit.isSuccess(exit)) return exit.value;
		throw thrownValue(exit.cause, errors);
	});
}

/**
 * Run an Effect inside a native `httpAction`. The program maps its own
 * failures to a `Response`; a defect rejects with the thrown value. No
 * `ConvexError` encoding happens here.
 */
export function runHttpAction(
	program: Effect.Effect<Response, never, ActionServices>,
	ctx: ActionCtx
): Promise<Response> {
	return Effect.runPromiseExit(Effect.provideContext(program, actionContext(ctx))).then((exit) => {
		if (Exit.isSuccess(exit)) return exit.value;
		throw thrownValue(exit.cause, []);
	});
}

export const queryContext = (ctx: QueryCtx): Context.Context<QueryServices> =>
	Context.make(DatabaseReader, ctx.db).pipe(
		Context.add(Auth, ctx.auth),
		Context.add(StorageReader, ctx.storage),
		Context.add(QueryRunner, ctx.runQuery),
		Context.add(Clock.Clock, queryClock)
	);

export const mutationContext = (ctx: MutationCtx): Context.Context<MutationServices> =>
	Context.make(DatabaseReader, ctx.db).pipe(
		Context.add(DatabaseWriter, ctx.db),
		Context.add(Auth, ctx.auth),
		Context.add(StorageReader, ctx.storage),
		Context.add(StorageWriter, ctx.storage),
		Context.add(QueryRunner, ctx.runQuery),
		Context.add(MutationRunner, ctx.runMutation),
		Context.add(ConvexScheduler, ctx.scheduler)
	);

const actionContext = (ctx: ActionCtx): Context.Context<ActionServices> =>
	Context.make(Auth, ctx.auth).pipe(
		Context.add(StorageReader, ctx.storage satisfies StorageActionWriter),
		Context.add(StorageWriter, ctx.storage),
		// The action runners also take an options argument; the transaction
		// signature is the subset both kinds accept.
		Context.add(QueryRunner, ctx.runQuery as QueryCtx['runQuery']),
		Context.add(MutationRunner, ctx.runMutation as MutationCtx['runMutation']),
		Context.add(ActionRunner, ctx.runAction),
		Context.add(ConvexScheduler, ctx.scheduler)
	);

/**
 * Run a definition's handler for one invocation: its program with the
 * invocation's services provided, through `runConvexHandler`. Every builder
 * calls its underlying builder with one inline registration, the form the
 * Convex lint rules read, and hands the handler to this.
 */
export function bridge<
	Args extends PropertyValidators,
	Out extends GenericValidator,
	E extends WireError,
	R extends S,
	S
>(
	kind: Kind,
	definition: Definition<Args, Out, E, R>,
	args: unknown,
	context: Context.Context<S>
): Promise<Infer<Out>> {
	// The builder validated `args` against `definition.args` before this runs.
	const program = definition.handler(args as ObjectType<Args>);
	return runConvexHandler(kind, Effect.provideContext(program, context), definition.errors ?? []);
}

/* The builders: internal ones here, authed and admin ones in `effectAuth.ts`.
 * A public builder without auth waits for `local/convex-access-first` to read a
 * guard inside an Effect handler. `R extends <Kind>Services` is the capability check: a handler
 * that yields a service its kind lacks does not compile. The builders infer their
 * registration from literal validators; the generic ones here are widened to
 * their constraint, and the result type restores them. */

export const effectInternalQuery = <
	Args extends PropertyValidators,
	Out extends GenericValidator,
	E extends WireError = never,
	R extends QueryServices = never
>(
	definition: Definition<Args, Out, E, R>
) =>
	internalQuery({
		args: definition.args as PropertyValidators,
		returns: definition.returns as GenericValidator,
		handler: (ctx, args) => bridge('query', definition, args, queryContext(ctx))
	}) as RegisteredQuery<'internal', ObjectType<Args>, Promise<Infer<Out>>>;

export const effectInternalMutation = <
	Args extends PropertyValidators,
	Out extends GenericValidator,
	E extends WireError = never,
	R extends MutationServices = never
>(
	definition: Definition<Args, Out, E, R>
) =>
	internalMutation({
		args: definition.args as PropertyValidators,
		returns: definition.returns as GenericValidator,
		handler: (ctx, args) => bridge('mutation', definition, args, mutationContext(ctx))
	}) as RegisteredMutation<'internal', ObjectType<Args>, Promise<Infer<Out>>>;

export const effectInternalAction = <
	Args extends PropertyValidators,
	Out extends GenericValidator,
	E extends WireError = never,
	R extends ActionServices = never
>(
	definition: Definition<Args, Out, E, R>
) =>
	internalAction({
		args: definition.args as PropertyValidators,
		returns: definition.returns as GenericValidator,
		handler: (ctx, args) => bridge('action', definition, args, actionContext(ctx))
	}) as RegisteredAction<'internal', ObjectType<Args>, Promise<Infer<Out>>>;
