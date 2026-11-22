import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import { continueErasure, erasePage } from './erasure';
import erasure from './erasure.spec';

export default GroupImpl.make(databaseSchema, erasure).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, erasure, 'continueErasure', continueErasure),
		FunctionImpl.make(databaseSchema, erasure, 'erasePage', erasePage)
	]),
	GroupImpl.finalize
);
