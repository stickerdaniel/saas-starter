---
name: effect-patterns
description: Effect 4 patterns of this template. Shared tagged errors, retries, bounded waits, the Lifetime for long-running owners, schedulers per runtime, tests with TestClock under Vitest and Bun, and the client bundle budget. Use when writing, reviewing or testing code that imports effect or src/lib/effect.
---

# Effect patterns

Effect is pinned to `4.1.4`, together with `@effect/vitest`. Read its source at tag `effect@4.1.4` (`btca.config.jsonc`, resource `effect`); `main` runs ahead of the installed release.

## Modules

| Module                     | Holds                                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/effect/errors`    | `Unauthenticated`, `Forbidden`, `NotFound`, `Invalid`, `RateLimited`, `Upstream`, `TransportLost` on `Data.TaggedError`; `isRetryable` (true for `TransportLost`, `RateLimited`) |
| `src/lib/effect/retry`     | `retryPolicy` (exponential from 200 ms, jitter, 5 s cap) and `withRetry(effect, { schedule?, times?, while? })`                                                                  |
| `src/lib/effect/timeout`   | `within(effect, duration, onTimeout)`, the bounded wait                                                                                                                          |
| `src/lib/effect/lifetime`  | `Lifetime`, the owner of long-running work                                                                                                                                       |
| `src/lib/effect/scheduler` | `syncScheduler()`, a `MixedScheduler("sync")` factory                                                                                                                            |
| `src/lib/effect/clock`     | `clockFromSleep(sleep)`, a `Clock` whose delays call an injected `sleep`                                                                                                         |
| `src/lib/effect/testing`   | `withTestClock(effect)` and `adjust(duration)`, without `@effect/vitest`, so they load under `bun test`                                                                          |
| `src/lib/effect/vitest`    | `it`, `describe`, `expect` from `@effect/vitest` (`it.effect` provides `TestClock`)                                                                                              |

The first seven are leaf modules: they import only `effect/*` subpaths, `convex/values` and each other. `local/effect-leaf-imports` enforces it, because forks copy the seven files as one set.

`errors.ts` imports no `effect/Schema`: Schema costs about 150 ms and 8 MB RSS per Bun process. Wire codecs that turn these errors into `{ code, ...data }` use `Schema.TaggedError` in their own module. `Schema.TaggedErrorClass` does not exist in 4.1.4.

## Rules that lint enforces

| Rule                           | Pattern                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `local/effect-subpath-import`  | `import * as Effect from 'effect/Effect'`; the `effect` barrel only for `import type`                   |
| `local/effect-run-boundary`    | `Effect.run*` and `ManagedRuntime.make` only in the `allow` modules; aliases and re-exports count       |
| `local/effect-no-raw-timers`   | `Effect.sleep`, a `Schedule` or `lifetime.after` instead of `setTimeout`, `setInterval`, `setImmediate` |
| `local/effect-no-promise-race` | `within` or `Effect.race` instead of `Promise.race`                                                     |
| `local/effect-tagged-errors`   | `Data.TaggedError('Name')` instead of `extends Error`                                                   |
| `local/effect-no-try-in-gen`   | no `try` around `yield*` in `Effect.gen` or `Effect.fn`                                                 |
| `local/effect-no-manual-retry` | `withRetry` instead of a loop that catches and sleeps                                                   |
| `local/effect-leaf-imports`    | the closed import set of the seven leaf modules                                                         |

Every rule takes `files` and `allow` globs in `eslint.config.js`. A converted directory joins `files`; a fork extends the globs for its own directories.

## One example per layer

**Convex queries and mutations.** The runtime rejects timers, so the handler program never sleeps, retries, times out or forks a non-immediate fiber. It runs on `MixedScheduler("sync")`, which continues past Effect's auto-yield after 2,048 operations without a timer:

```ts
import * as Effect from 'effect/Effect';
import { NotFound } from '#lib/effect/errors.js';

const loadThread = (id: string) =>
	Effect.gen(function* () {
		const thread = yield* Effect.promise(() => ctx.db.get(id));
		if (!thread) return yield* new NotFound({ code: 'THREAD_NOT_FOUND' });
		return thread;
	});
```

Durable retries and delays stay on `ctx.scheduler`, crons and Workpool.

**Convex actions and the SvelteKit server.** The default scheduler. A network call gets one bounded wait and a retry for retryable failures:

```ts
import * as Effect from 'effect/Effect';
import { TransportLost, Upstream } from '#lib/effect/errors.js';
import { withRetry } from '#lib/effect/retry.js';
import { within } from '#lib/effect/timeout.js';

const send = (body: string) =>
	Effect.tryPromise({
		try: (signal) => fetch(URL, { method: 'POST', body, signal }),
		catch: (cause) => new TransportLost({ cause })
	}).pipe(
		Effect.flatMap((response) =>
			response.ok
				? Effect.succeed(response)
				: Effect.fail(new Upstream({ service: 'mail', cause: response.status }))
		)
	);

const sendBounded = (body: string) =>
	within(withRetry(send(body)), '8 seconds', () =>
		Effect.fail(new TransportLost({ cause: 'timeout' }))
	);
```

`withRetry` defaults to `retryPolicy`, 3 retries after the first attempt and `isRetryable`. `while` receives every failure, tagged or not, and runs only before a retry that `times` still allows, so it can carry an `onRetry` side effect. Delays run on the fiber's `Clock`. A fixed policy: `withRetry(effect, { schedule: Schedule.spaced('300 millis'), times: 1 })`.

**Browser.** Svelte state stays in runes. Effect runs in the async flows behind a component, never in a `(marketing)` route's initial JS: `bun run build` fails when a marketing page or a layout above it imports an Effect module. A lazy chunk, such as the support widget's, may hold Effect.

## Long-running processes

A `Lifetime` owns the work of one owner (a session, a connection, a bridge). It is constructed synchronously.

- `lifetime.run(effect)` starts the program now, on the lifetime's scheduler, and returns its fiber. The first instruction registers the fiber and checks admission. After `end()` it returns an already-interrupted fiber and runs no step. The program's ambient `Scope` is the lifetime's scope.
- `lifetime.after(ms, fn)` calls `fn` once after `ms` unless the returned cancel function ran or the lifetime ended.
- `lifetime.end()` returns in the same call and never throws. It closes admission, interrupts every registered fiber and starts the scope's cleanup uninterruptibly. A failed cleanup goes to `onCleanupFailure` (default: one `Lifetime cleanup failed` error log; pass a redacting callback where causes can hold user data). A reentrant `end()` inside a run lets the current synchronous callback finish; the next interpreted step does not run.
- `lifetime.whenClosed()` resolves when the cleanup and every interrupted fiber finished. Tests and shutdown paths await it.
- `new Lifetime({ scheduler: syncScheduler() })` keeps every run and its auto-yields on the sync scheduler.

Finalizers:

- `Effect.addFinalizer` on the lifetime scope is for resources that live as long as the owner. It runs at `end()`, not when one run completes: 100 completed runs that each add one leave 100 finalizers, and none runs before `end()`. Register it once per resource, never once per run.
- A synchronous `Effect.sync` finalizer on the lifetime scope has run when `end()` returns, from outside or reentrant. A finalizer that yields (thousands of operations) or awaits completes by `whenClosed()`.
- A per-run `finally` is `Effect.ensuring`. It runs when the run's interruption is processed, with no ordering promise relative to the return of `end()`.

Children:

- Work on a lifetime starts children only through `lifetime.run` or `Effect.forkChild` without options.
- `Effect.forkChild` with `{ uninterruptible: true }` keeps running after `end()`. With `{ startImmediately: true }` it takes one more step after an `end()` in its first slice. `Effect.forkScoped` attaches to a scope other than the lifetime's.

Accepted work, such as a write the user already saw confirmed, must finish even when the owner ends. It runs off the lifetime, on the process runtime.

Facades:

- A Promise facade awaits the fiber's exit, interrupted or not, and maps it; it never assumes the run started.
- No `try` around `yield*`: typed failures and interruption arrive through the fiber. Use `Effect.catchTag`, `Effect.catch`, `Effect.result` and `Effect.ensuring`.

## Tests

- Vitest: `import { it } from '#lib/effect/vitest.js'` and `it.effect(...)`. `it.effect` provides `TestClock`; fork the timed program, `TestClock.adjust`, then `Fiber.join`.
- `bun test`: import from `vitest` (Bun maps it to `bun:test`) and `#lib/effect/testing.js`. `withTestClock(program)` provides `TestClock`; `adjust` moves it. `bun run test:bun` runs the suites that must pass on both runners.
- Code whose tests inject a `sleep` keeps that seam and passes `clockFromSleep(sleep)` as the `Clock` service.

## Bundle budget

`bun run build` runs `scripts/check-bundle-budget.ts`. It reads the client module graph that `scripts/module-graph-plugin.ts` writes, builds each route's initial closure (Kit entries, layouts, page, static imports) and lazy closure, and sums gzip -9 sizes.

- It fails when a `(marketing)` route's initial closure holds a module from `effect` or `@effect/*`, and when a route has no entry in `bundle-budget.json`.
- Public variables gate client code (`PUBLIC_SENTRY_DSN` moves Sentry into every initial closure). Sizes are compared only on a build whose unset public variables equal the file's `unsetPublicEnv`: the CI Node container build and a local build with the same configuration.
- The allowance over each baseline is 40 KB gzip for app routes and 1 KB for `(marketing)` routes, which covers inlined URL lengths.
- A new route gets its entry by running `bun scripts/check-bundle-budget.ts --write` after a build with the file's configuration, then reverting every other changed entry. A baseline moves only with a reviewed reason.
