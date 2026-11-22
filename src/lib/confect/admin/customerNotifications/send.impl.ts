import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import { enqueueRecipient, sendCancellation, sendNewCustomer } from './send';
import send from './send.spec';

export default GroupImpl.make(databaseSchema, send).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, send, 'enqueueRecipient', enqueueRecipient),
		FunctionImpl.make(databaseSchema, send, 'sendCancellation', sendCancellation),
		FunctionImpl.make(databaseSchema, send, 'sendNewCustomer', sendNewCustomer)
	]),
	GroupImpl.finalize
);
