import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { cleanupExpiredFiles } from './cleanup';
import cleanup from './cleanup.spec';

export default GroupImpl.make(databaseSchema, cleanup).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, cleanup, 'cleanupExpiredFiles', cleanupExpiredFiles)
	]),
	GroupImpl.finalize
);
