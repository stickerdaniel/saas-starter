import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { deleteUnusedFiles } from './vacuum';
import vacuum from './vacuum.spec';

export default GroupImpl.make(databaseSchema, vacuum).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, vacuum, 'deleteUnusedFiles', deleteUnusedFiles)
	]),
	GroupImpl.finalize
);
