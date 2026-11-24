import { MiddlewareSpec } from '@confect/core';
import * as Context from 'effect/Context';
import type * as Option from 'effect/Option';
import type { SupportOwnerIdentity } from '../support/ownership';

export class SupportOwner extends Context.Service<
	SupportOwner,
	Option.Option<SupportOwnerIdentity>
>()('confect/middleware/VisitorAccess.spec/SupportOwner') {}

export default class VisitorAccess extends MiddlewareSpec.MiddlewareSpec<
	VisitorAccess,
	{ provides: SupportOwner }
>()('VisitorAccess', {
	functionTypes: { query: true, mutation: true, action: false }
}) {}
