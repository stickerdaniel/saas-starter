import { FunctionSpec, GroupSpec } from '@confect/core';
import type { migrateAnonymousTickets } from './migration';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexPublicMutation<typeof migrateAnonymousTickets>()('migrateAnonymousTickets')
);
