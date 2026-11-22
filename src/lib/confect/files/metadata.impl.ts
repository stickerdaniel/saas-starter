import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { storeFileMetadata } from './metadata';
import metadata from './metadata.spec';

export default GroupImpl.make(databaseSchema, metadata).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, metadata, 'storeFileMetadata', storeFileMetadata)
	]),
	GroupImpl.finalize
);
