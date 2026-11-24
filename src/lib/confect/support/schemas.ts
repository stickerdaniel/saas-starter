import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';

export const SupportOwnerArgsSchema = Schema.Struct({
	anonymousUserId: Schema.optional(Schema.String)
});

export const ThreadReadArgsSchema = Schema.Struct({
	threadId: Schema.String,
	anonymousUserId: Schema.optional(Schema.String),
	readThroughMessageId: Schema.String
});

export const TicketMigrationArgsSchema = Schema.Struct({ anonymousUserId: Schema.String });

export const PromptLocaleArgsSchema = Schema.Struct({ locale: Schema.optional(Schema.String) });

export const SavePromptArgsSchema = Schema.Struct({
	systemPrompt: Schema.String,
	locale: Schema.optional(Schema.String),
	note: Schema.optional(Schema.String)
});

export const PromptActivationArgsSchema = Schema.Struct({
	id: Id('supportAgentPrompts'),
	active: Schema.Boolean
});
