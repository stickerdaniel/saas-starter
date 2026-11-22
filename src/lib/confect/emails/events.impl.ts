import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import { handleEmailEvent } from './events';
import events from './events.spec';

export default GroupImpl.make(databaseSchema, events).pipe(
	Layer.provide([FunctionImpl.make(databaseSchema, events, 'handleEmailEvent', handleEmailEvent)]),
	GroupImpl.finalize
);
