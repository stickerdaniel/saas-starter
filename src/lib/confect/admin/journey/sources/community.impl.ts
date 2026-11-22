import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../../_generated/schema';
import { read } from './community';
import community from './community.spec';

export default GroupImpl.make(databaseSchema, community).pipe(
	Layer.provide([FunctionImpl.make(databaseSchema, community, 'read', read)]),
	GroupImpl.finalize
);
