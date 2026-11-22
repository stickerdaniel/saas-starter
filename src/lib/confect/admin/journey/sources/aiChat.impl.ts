import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../../../_generated/schema';
import { read } from './aiChat';
import aiChat from './aiChat.spec';

export default GroupImpl.make(databaseSchema, aiChat).pipe(
	Layer.provide([FunctionImpl.make(databaseSchema, aiChat, 'read', read)]),
	GroupImpl.finalize
);
