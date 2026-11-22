import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../_generated/schema';
import { cleanupReceipts, enqueueRecipient } from './notificationDelivery';
import notificationDelivery from './notificationDelivery.spec';

export default GroupImpl.make(databaseSchema, notificationDelivery).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, notificationDelivery, 'cleanupReceipts', cleanupReceipts),
		FunctionImpl.make(databaseSchema, notificationDelivery, 'enqueueRecipient', enqueueRecipient)
	]),
	GroupImpl.finalize
);
