import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Layer from 'effect/Layer';
import databaseSchema from '../_generated/schema';
import {
	createAIResponse,
	createAssistantMessage,
	ensureSupportTurnSettled,
	getFileMetadataBatch,
	getTurnOutcome,
	listMessages,
	sendMessage
} from './messages';
import messages from './messages.spec';

export default GroupImpl.make(databaseSchema, messages).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, messages, 'createAIResponse', createAIResponse),
		FunctionImpl.make(databaseSchema, messages, 'createAssistantMessage', createAssistantMessage),
		FunctionImpl.make(
			databaseSchema,
			messages,
			'ensureSupportTurnSettled',
			ensureSupportTurnSettled
		),
		FunctionImpl.make(databaseSchema, messages, 'getFileMetadataBatch', getFileMetadataBatch),
		FunctionImpl.make(databaseSchema, messages, 'getTurnOutcome', getTurnOutcome),
		FunctionImpl.make(databaseSchema, messages, 'listMessages', listMessages),
		FunctionImpl.make(databaseSchema, messages, 'sendMessage', sendMessage)
	]),
	GroupImpl.finalize
);
