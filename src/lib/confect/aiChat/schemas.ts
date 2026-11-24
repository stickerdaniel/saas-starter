import * as Schema from 'effect/Schema';
import { Id } from '../_generated/id';

export const MigrationStartArgsSchema = Schema.Struct({ restart: Schema.optional(Schema.Boolean) });

export const MigrationProgressSchema = Schema.Struct({
	version: Schema.Literal(1),
	status: Schema.Literals(['running', 'complete']),
	processed: Schema.Number
});

export const MigrationPageArgsSchema = Schema.Struct({
	id: Id('aiChatHistoryMigration'),
	cursor: Schema.NullOr(Schema.String)
});

export const TitleArgsSchema = Schema.Struct({
	threadId: Schema.String,
	prompt: Schema.String,
	userId: Schema.optional(Schema.String)
});
