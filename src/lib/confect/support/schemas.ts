import * as Schema from 'effect/Schema';

export const SupportOwnerArgsSchema = Schema.Struct({
	anonymousUserId: Schema.optional(Schema.String)
});

export const ThreadReadArgsSchema = Schema.Struct({
	threadId: Schema.String,
	anonymousUserId: Schema.optional(Schema.String),
	readThroughMessageId: Schema.String
});
