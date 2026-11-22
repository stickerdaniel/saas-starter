import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from './_generated/schema';
import {
	enforceAndTrackMessageUsage,
	list,
	markMessageSettled,
	removeMessage,
	send
} from './messages';
import messages from './messages.spec';

export default GroupImpl.make(databaseSchema, messages).pipe(
	Layer.provide([
		FunctionImpl.make(
			databaseSchema,
			messages,
			'enforceAndTrackMessageUsage',
			enforceAndTrackMessageUsage
		),
		FunctionImpl.make(databaseSchema, messages, 'list', list),
		FunctionImpl.make(databaseSchema, messages, 'markMessageSettled', markMessageSettled),
		FunctionImpl.make(databaseSchema, messages, 'removeMessage', removeMessage),
		FunctionImpl.make(databaseSchema, messages, 'send', send)
	]),
	GroupImpl.finalize
);
