import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { SupportRefusalCodec } from '../errorCodecs';
import RequireUser from '../middleware/RequireUser.spec';
import { TicketMigrationArgsSchema } from './schemas';

export default GroupSpec.make().addFunction(
	FunctionSpec.publicMutation({
		name: 'migrateAnonymousTickets',
		args: () => TicketMigrationArgsSchema.fields,
		returns: () => Schema.Struct({ migratedCount: Schema.Number }),
		error: () => SupportRefusalCodec
	}).middleware(RequireUser)
);
