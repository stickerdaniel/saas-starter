import { MixedScheduler } from 'effect/Scheduler';

/**
 * The scheduler for every runtime that must not yield through a timer: Convex
 * queries and mutations (which reject timers) and the Cloudflare Worker runtime
 * (which can discard timers a request owns). Pass it as the `scheduler` run
 * option of the root run, so every later auto-yield stays on it:
 *
 * ```ts
 * Effect.runPromiseExit(program, { scheduler: syncScheduler() });
 * ```
 *
 * Auto-yields resume on a microtask, so no other macrotask runs in between.
 */
export const syncScheduler = (): MixedScheduler => new MixedScheduler('sync');
