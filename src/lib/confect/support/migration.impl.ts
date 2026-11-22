import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { migrateAnonymousTickets } from './migration';
import migration from './migration.spec';

export default GroupImpl.make(databaseSchema, migration).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, migration, 'migrateAnonymousTickets', migrateAnonymousTickets)
	]),
	GroupImpl.finalize
);
