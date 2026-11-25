import { FunctionSpec, GroupSpec } from '@confect/core';
import * as Schema from 'effect/Schema';
import { Id } from './_generated/id';
import { CommunityRefusalCodec, RateLimitedCodec } from './errorCodecs';
import RequireUser from './middleware/RequireUser.spec';
import { MessageFields } from './schemas/messages';

const MessageIdArgs = () => ({ messageId: Id('messages') });

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
			returns: () =>
				Schema.Array(
					Schema.Struct({
						_id: Id('messages'),
						_creationTime: Schema.Number,
						...MessageFields,
						author: Schema.String,
						authorImage: Schema.optional(Schema.String)
					})
				)
		}).middleware(RequireUser)
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
			returns: () => Schema.Struct({ messageId: Id('messages') }),
			error: () => Schema.Union([CommunityRefusalCodec, RateLimitedCodec])
		}).middleware(RequireUser)
	);
