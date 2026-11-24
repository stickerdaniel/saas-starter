import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { RateLimitedCodec, SupportRefusalCodec } from '../errorCodecs';
import VisitorAccess from '../middleware/VisitorAccess.spec';
import {
	AIResponseArgsSchema,
	AssistantMessageArgsSchema,
	FileMetadataBatchArgsSchema,
	FileMetadataBatchSchema,
	SavedAssistantMessageSchema,
	SendMessageArgsSchema,
	SentMessageSchema,
	TurnArgsSchema,
	TurnOutcomeSchema,
	TurnWatchArgsSchema,
	VisitorMessageListArgsSchema,
	VisitorMessageListSchema
} from './schemas';

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalAction({
			name: 'createAIResponse',
			args: () => AIResponseArgsSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'createAssistantMessage',
			args: () => AssistantMessageArgsSchema.fields,
			returns: () => SavedAssistantMessageSchema
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'ensureSupportTurnSettled',
			args: () => TurnWatchArgsSchema.fields,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'getFileMetadataBatch',
			args: () => FileMetadataBatchArgsSchema.fields,
			returns: () => FileMetadataBatchSchema
		})
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'getTurnOutcome',
			args: () => TurnArgsSchema.fields,
			returns: () => TurnOutcomeSchema
		})
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'listMessages',
			args: () => VisitorMessageListArgsSchema.fields,
			returns: () => VisitorMessageListSchema,
			error: () => SupportRefusalCodec
		}).middleware(VisitorAccess)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'sendMessage',
			args: () => SendMessageArgsSchema.fields,
			returns: () => SentMessageSchema,
			error: () => Schema.Union([SupportRefusalCodec, RateLimitedCodec])
		}).middleware(VisitorAccess)
	);
