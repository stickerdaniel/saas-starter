/**
 * T0 spike: the Confect database schema for the tables the spike handlers read
 * and write, mirroring their `defineTable` in `src/lib/convex/schema.ts`. The
 * deployed schema stays `schema.ts`; this one only decodes and encodes.
 *
 * `@confect/cli` generates this file and `services.ts` in a Confect project.
 */
import { GenericId, Table } from '@confect/core';
import { DatabaseSchema, type Document } from '@confect/server';
import type { SystemTableNames } from 'convex/server';
import * as Schema from 'effect/Schema';

export type TableNames =
	'passkeyNudgeDismissals' | 'messages' | 'aiChatThreads' | 'aiChatHistoryMigration';

export type Id<TableName extends TableNames | SystemTableNames> = GenericId.GenericId<TableName>;
export const Id = <const TableName extends TableNames | SystemTableNames>(tableName: TableName) =>
	GenericId.GenericId(tableName);

const passkeyNudgeDismissals = Table.make(() =>
	Schema.Struct({ userId: Schema.String, deferredUntil: Schema.Finite })
).index('by_userId', ['userId'])('passkeyNudgeDismissals');

const messages = Table.make(() =>
	Schema.Struct({
		userId: Schema.String,
		body: Schema.String,
		quotaSettledAt: Schema.optional(Schema.Finite)
	})
)('messages');

const aiChatThreads = Table.make(() =>
	Schema.Struct({
		threadId: Schema.String,
		userId: Schema.String,
		createdAt: Schema.Finite,
		isWarm: Schema.optional(Schema.Boolean),
		title: Schema.optional(Schema.String),
		lastMessage: Schema.optional(Schema.String),
		lastMessageAt: Schema.optional(Schema.Finite),
		sidebarActivityAt: Schema.optional(Schema.Finite)
	})
)('aiChatThreads');

const aiChatHistoryMigration = Table.make(() =>
	Schema.Struct({
		version: Schema.Literal(1),
		status: Schema.Literals(['running', 'complete']),
		cursor: Schema.NullOr(Schema.String),
		processed: Schema.Finite,
		scheduledFnId: Schema.optional(Id('_scheduled_functions'))
	})
)('aiChatHistoryMigration');

const databaseSchema: DatabaseSchema.DatabaseSchema<{
	readonly passkeyNudgeDismissals: typeof passkeyNudgeDismissals;
	readonly messages: typeof messages;
	readonly aiChatThreads: typeof aiChatThreads;
	readonly aiChatHistoryMigration: typeof aiChatHistoryMigration;
}> = DatabaseSchema.make({
	passkeyNudgeDismissals,
	messages,
	aiChatThreads,
	aiChatHistoryMigration
});

export default databaseSchema;

export interface Docs {
	passkeyNudgeDismissals: Document.Document<typeof databaseSchema, 'passkeyNudgeDismissals'>;
	messages: Document.Document<typeof databaseSchema, 'messages'>;
	aiChatThreads: Document.Document<typeof databaseSchema, 'aiChatThreads'>;
	aiChatHistoryMigration: Document.Document<typeof databaseSchema, 'aiChatHistoryMigration'>;
}
