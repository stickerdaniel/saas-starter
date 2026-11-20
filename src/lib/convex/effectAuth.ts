/**
 * The authed and admin Effect builders, over the custom builders in
 * `functions.ts`. They authenticate before the handler, exactly as those do, and
 * provide the user as `CurrentUser`. Kept apart from `effect.ts` because
 * `functions.ts` loads Better Auth.
 */
import * as Context from 'effect/Context';
import type { RegisteredMutation, RegisteredQuery } from 'convex/server';
import type { GenericValidator, Infer, ObjectType, PropertyValidators } from 'convex/values';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { BetterAuthUser } from './admin/types';
import {
	bridge,
	mutationContext,
	queryContext,
	type Definition,
	type MutationServices,
	type QueryServices,
	type WireError
} from './effect';
import { adminMutation, adminQuery, authedMutation, authedQuery } from './functions';

/** The signed-in user, provided by the authed and admin builders. */
export class CurrentUser extends Context.Service<CurrentUser, BetterAuthUser>()(
	'convex/CurrentUser'
) {}

const withQueryUser = (
	ctx: QueryCtx & { user: BetterAuthUser }
): Context.Context<QueryServices | CurrentUser> =>
	Context.add(queryContext(ctx), CurrentUser, ctx.user);
const withMutationUser = (
	ctx: MutationCtx & { user: BetterAuthUser }
): Context.Context<MutationServices | CurrentUser> =>
	Context.add(mutationContext(ctx), CurrentUser, ctx.user);

export const effectAuthedQuery = <
	Args extends PropertyValidators,
	Out extends GenericValidator,
	E extends WireError = never,
	R extends QueryServices | CurrentUser = never
>(
	definition: Definition<Args, Out, E, R>
) =>
	authedQuery({
		args: definition.args as PropertyValidators,
		returns: definition.returns as GenericValidator,
		handler: (ctx, args) => bridge('query', definition, args, withQueryUser(ctx))
	}) as RegisteredQuery<'public', ObjectType<Args>, Promise<Infer<Out>>>;

export const effectAdminQuery = <
	Args extends PropertyValidators,
	Out extends GenericValidator,
	E extends WireError = never,
	R extends QueryServices | CurrentUser = never
>(
	definition: Definition<Args, Out, E, R>
) =>
	adminQuery({
		args: definition.args as PropertyValidators,
		returns: definition.returns as GenericValidator,
		handler: (ctx, args) => bridge('query', definition, args, withQueryUser(ctx))
	}) as RegisteredQuery<'public', ObjectType<Args>, Promise<Infer<Out>>>;

export const effectAuthedMutation = <
	Args extends PropertyValidators,
	Out extends GenericValidator,
	E extends WireError = never,
	R extends MutationServices | CurrentUser = never
>(
	definition: Definition<Args, Out, E, R>
) =>
	authedMutation({
		args: definition.args as PropertyValidators,
		returns: definition.returns as GenericValidator,
		handler: (ctx, args) => bridge('mutation', definition, args, withMutationUser(ctx))
	}) as RegisteredMutation<'public', ObjectType<Args>, Promise<Infer<Out>>>;

export const effectAdminMutation = <
	Args extends PropertyValidators,
	Out extends GenericValidator,
	E extends WireError = never,
	R extends MutationServices | CurrentUser = never
>(
	definition: Definition<Args, Out, E, R>
) =>
	adminMutation({
		args: definition.args as PropertyValidators,
		returns: definition.returns as GenericValidator,
		handler: (ctx, args) => bridge('mutation', definition, args, withMutationUser(ctx))
	}) as RegisteredMutation<'public', ObjectType<Args>, Promise<Infer<Out>>>;
