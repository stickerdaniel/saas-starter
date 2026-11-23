import { MiddlewareSpec } from '@confect/core';
import * as Context from 'effect/Context';
import type { authComponent } from '../authServer';
import { UnauthenticatedCodec } from '../errorCodecs';

type SignedInUser = NonNullable<Awaited<ReturnType<typeof authComponent.safeGetAuthUser>>>;

export class CurrentUser extends Context.Service<CurrentUser, SignedInUser>()(
	'confect/middleware/RequireUser.spec/CurrentUser'
) {}

export default class RequireUser extends MiddlewareSpec.MiddlewareSpec<
	RequireUser,
	{ provides: CurrentUser }
>()('RequireUser', {
	error: () => UnauthenticatedCodec,
	functionTypes: { query: true, mutation: true, action: false }
}) {}
