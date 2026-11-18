/**
 * Access calls for public Convex handlers. Every public `query`, `mutation` and
 * `action` handler awaits an access call before any effect; the ESLint rules
 * `@convex-dev/require-access-control` and `local/convex-access-first` read
 * the call by its name. Custom builders in `functions.ts` check identity
 * themselves.
 */
import type { FunctionReference, OptionalRestArgs } from 'convex/server';
import type { ActionCtx } from './_generated/server';

/**
 * Marks a public function that serves every caller on purpose. Call it first in
 * the handler; the reason says who calls it and what bounds the call.
 */
export function publicEndpoint(_reason: string): void {}

/**
 * Runs an internal mutation as an action's access check. The mutation throws to
 * refuse the caller and returns null otherwise.
 */
export async function requireActionAccess<
	Check extends FunctionReference<'mutation', 'internal', Record<string, unknown>, null>
>(ctx: ActionCtx, check: Check, ...args: OptionalRestArgs<Check>): Promise<void> {
	await ctx.runMutation(check, ...args);
}
