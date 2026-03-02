import type { ConvexClient } from 'convex/browser';
import type { FieldDefinition, ResourceRuntime } from './types';

/**
 * Create a tag upsert handler for a given field and runtime.
 * Returns a function that accepts a tag name, calls the upsert mutation,
 * refreshes relation options, and returns the new tag ID.
 */
export function createTagUpsertHandler(args: {
	field: FieldDefinition<any>;
	runtime: ResourceRuntime;
	client: ConvexClient;
	onOptionsRefresh: () => void;
}): ((name: string) => Promise<string | null>) | undefined {
	const { field, runtime, client, onOptionsRefresh } = args;
	if (field.type !== 'tag') return undefined;
	if (!field.tagConfig?.allowCreate) return undefined;
	if (!runtime.upsertRelation) return undefined;

	const upsertMutation = runtime.upsertRelation[field.attribute];
	if (!upsertMutation) return undefined;

	return async (name: string): Promise<string | null> => {
		try {
			const result = (await client.mutation(upsertMutation, { name } as never)) as {
				id: string;
			};
			// Trigger a refresh of relation options so the new tag appears in the dropdown
			onOptionsRefresh();
			return result.id;
		} catch (error) {
			console.error(`[admin:tag-upsert] Failed to create tag "${name}"`, error);
			return null;
		}
	};
}

/**
 * Build a map of onCreateTag handlers for all tag fields in a resource.
 */
export function buildTagUpsertHandlers(args: {
	fields: FieldDefinition<any>[];
	runtime: ResourceRuntime;
	client: ConvexClient;
	onOptionsRefresh: () => void;
}): Record<string, (name: string) => Promise<string | null>> {
	const handlers: Record<string, (name: string) => Promise<string | null>> = {};
	for (const field of args.fields) {
		const handler = createTagUpsertHandler({
			field,
			runtime: args.runtime,
			client: args.client,
			onOptionsRefresh: args.onOptionsRefresh
		});
		if (handler) {
			handlers[field.attribute] = handler;
		}
	}
	return handlers;
}
