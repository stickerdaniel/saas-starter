import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from './_generated/id';
import { CommunityRefusalCodec, RateLimitedCodec, UnauthenticatedCodec } from './errorCodecs';
import RequireUser from './middleware/RequireUser.spec';
import { MessageFields } from './schemas/messages';

const MessageIdArgs = () => ({ messageId: Id('messages') });

const CommunityMessages = Schema.Array(
	Schema.Struct({
		_id: Id('messages'),
		_creationTime: Schema.Number,
		...MessageFields,
		author: Schema.String,
		authorImage: Schema.optional(Schema.String)
	})
);

const SentMessage = Schema.Struct({ messageId: Id('messages') });

export default GroupSpec.make()
	.addFunction(
		FunctionSpec.internalAction({
			name: 'enforceAndTrackMessageUsage',
			args: () => ({ userId: Schema.String, messageId: Id('messages') }),
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.publicQuery({
			name: 'list',
			args: () => ({}),
			returns: () => CommunityMessages
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.internalQuery({
			name: 'listAs',
			args: () => ({ userId: Schema.String }),
			returns: () => CommunityMessages,
			error: () => UnauthenticatedCodec
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'markMessageSettled',
			args: MessageIdArgs,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'removeMessage',
			args: MessageIdArgs,
			returns: () => Schema.Null
		})
	)
	.addFunction(
		FunctionSpec.publicMutation({
			name: 'send',
			args: () => ({ body: Schema.String }),
			returns: () => SentMessage,
			error: () => Schema.Union([CommunityRefusalCodec, RateLimitedCodec])
		}).middleware(RequireUser)
	)
	.addFunction(
		FunctionSpec.internalMutation({
			name: 'sendAs',
			args: () => ({ userId: Schema.String, body: Schema.String }),
			returns: () => SentMessage,
			error: () => Schema.Union([CommunityRefusalCodec, RateLimitedCodec, UnauthenticatedCodec])
		})
	);
