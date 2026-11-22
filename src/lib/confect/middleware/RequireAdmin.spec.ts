import { MiddlewareSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { AdminAccessRequiredCodec, UnauthenticatedCodec } from '../errorCodecs';
import type { CurrentUser } from './RequireUser.spec';

export default class RequireAdmin extends MiddlewareSpec.MiddlewareSpec<
	RequireAdmin,
	{ provides: CurrentUser }
>()('RequireAdmin', {
	error: () => Schema.Union([UnauthenticatedCodec, AdminAccessRequiredCodec]),
	functionTypes: { query: true, mutation: true, action: false }
}) {}
