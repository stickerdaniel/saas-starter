import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { runPage, start, status } from './activityMigration';
import activityMigration from './activityMigration.spec';

export default GroupImpl.make(databaseSchema, activityMigration).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, activityMigration, 'runPage', runPage),
		FunctionImpl.make(databaseSchema, activityMigration, 'start', start),
		FunctionImpl.make(databaseSchema, activityMigration, 'status', status)
	]),
	GroupImpl.finalize
);
