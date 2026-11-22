import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import { admitObservation } from './admission';
import admission from './admission.spec';

export default GroupImpl.make(databaseSchema, admission).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, admission, 'admitObservation', admitObservation)
	]),
	GroupImpl.finalize
);
