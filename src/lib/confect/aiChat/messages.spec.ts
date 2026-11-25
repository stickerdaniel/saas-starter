import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { MessageListSchema } from '../admin/support/schemas';
import { AiChatRefusalCodec, RateLimitedCodec } from '../errorCodecs';
import RequireUser from '../middleware/RequireUser.spec';
import {
	AIResponseArgsSchema,
	FileMetadataBatchArgsSchema,
	FileMetadataBatchSchema,
	MessageListArgsSchema,
	SendMessageArgsSchema,
	SentMessageSchema
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
		FunctionSpec.publicQuery({
			name: 'getFileMetadataBatch',
			args: () => FileMetadataBatchArgsSchema.fields,
			returns: () => FileMetadataBatchSchema
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'listMessages',
			args: () => MessageListArgsSchema.fields,
			returns: () => MessageListSchema,
			error: () => AiChatRefusalCodec
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'sendMessage',
			args: () => SendMessageArgsSchema.fields,
			returns: () => SentMessageSchema,
			error: () => Schema.Union([AiChatRefusalCodec, RateLimitedCodec])
		}).middleware(RequireUser)
	);
