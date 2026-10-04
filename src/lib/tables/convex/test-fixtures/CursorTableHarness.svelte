<script lang="ts">
	import type { ConvexClient } from 'convex/browser';
	import { makeFunctionReference } from 'convex/server';
	import { setConvexClientContext } from 'convex-svelte';
	import * as v from 'valibot';
	import { createConvexCursorTable } from '../create-convex-cursor-table.svelte.ts';
	import type { CursorListResult } from '../contract';

	let { client }: { client: ConvexClient } = $props();
	// The client is fixed for each mounted test.
	// svelte-ignore state_referenced_locally
	setConvexClientContext(client);

	export const table = createConvexCursorTable({
		listQuery: makeFunctionReference<
			'query',
			{ cursor?: string; role: string },
			CursorListResult<string>
		>('test:list'),
		countQuery: makeFunctionReference<'query', { role: string }, number>('test:count'),
		urlSchema: v.object({
			search: v.optional(v.string(), ''),
			sort: v.optional(v.string(), ''),
			page: v.optional(v.string(), '1'),
			page_size: v.optional(v.string(), '1'),
			cursor: v.optional(v.string(), ''),
			role: v.optional(v.string(), 'all')
		}),
		defaultFilters: { role: 'all' },
		pageSizes: [1, 10],
		defaultPageSize: 1,
		sortFields: ['name'],
		buildListArgs: ({ cursor, filters }) => ({ cursor: cursor ?? undefined, role: filters.role }),
		buildCountArgs: ({ filters }) => ({ role: filters.role }),
		resolveLastPage: async () => ({ page: 12, cursor: 'last' }),
		toListResult: (result) => result,
		toCount: (result) => result
	});
</script>

<p>Page {table.pageIndex + 1} of {table.pageCount}</p>
