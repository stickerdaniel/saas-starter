import { MiddlewareSpec } from '@confect/core';
import * as Context from 'effect/Context';
import { SupportAuthenticationRequiredCodec } from '../errorCodecs';
import type { SupportOwnerIdentity } from '../support/ownership';

export class SupportOwner extends Context.Service<SupportOwner, SupportOwnerIdentity>()(
	'confect/middleware/VisitorAccess.spec/SupportOwner'
) {}

export default class VisitorAccess extends MiddlewareSpec.MiddlewareSpec<
	VisitorAccess,
	{ provides: SupportOwner }
>()('VisitorAccess', {
	error: () => SupportAuthenticationRequiredCodec,
	functionTypes: { query: true, mutation: true, action: false }
}) {}
