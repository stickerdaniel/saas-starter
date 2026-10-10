<script lang="ts">
	import { Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import type { ColumnDef } from '@tanstack/table-core';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { createSvelteTable, renderSnippet } from '#lib/components/ui/data-table/index.js';
	import type { DataTableFeatures } from '#lib/components/ui/data-table/data-table.svelte.ts';
	import en from '../../../../i18n/en.json';
	import ConvexCursorTableShell from '../convex-cursor-table-shell.svelte';
	import DataTableView from '../data-table-view.svelte';

	type Item = { id: string; member: string; email: string; action: string };
	const tolgee = Tolgee().use(FormatIcu()).init({ language: 'en', staticData: { en } });
	const data: Item[] = Array.from({ length: 24 }, (_, index) => ({
		id: String(index + 1),
		member: `Member ${index + 1}`,
		email: `member${index + 1}@example.test`,
		action: 'Review completed'
	}));
	const columns: Array<ColumnDef<DataTableFeatures, Item>> = [
		{ accessorKey: 'member', header: 'Member', size: 240 },
		{ accessorKey: 'email', header: 'Email', size: 320 },
		{ accessorKey: 'action', header: 'Action', size: 280 },
		{
			id: 'review',
			header: () => renderSnippet(reviewHeading),
			size: 220,
			cell: ({ row }) => renderSnippet(reviewControl, row.original)
		}
	];
	let pageIndex = $state(0);
	const table = createSvelteTable({ data, columns, getRowId: (row) => row.id });
</script>

{#snippet reviewHeading()}
	<span class="block py-3">Review<br />member access</span>
{/snippet}

{#snippet reviewControl(item: Item)}
	<Button variant="outline" size="sm">Review {item.id}</Button>
{/snippet}

<Tooltip.Provider>
	<TolgeeProvider {tolgee}>
		<main class="mx-auto max-w-3xl p-6">
			<h1 id="table-panel-title" class="mb-6 text-xl font-semibold">Table scroll contract</h1>
			<div class="h-135 overflow-auto" data-testid="page-viewport">
				<section aria-labelledby="table-panel-title" class="flex h-90 min-w-0 flex-col">
					<ConvexCursorTableShell
						testIdPrefix="scroll-check"
						searchValue=""
						searchPlaceholder="Search members"
						onSearchChange={() => {}}
						{pageIndex}
						pageCount={2}
						pageSize={24}
						pageSizeOptions={[24]}
						showRowsPerPage={false}
						canPreviousPage={pageIndex > 0}
						canNextPage={pageIndex === 0}
						onFirstPage={() => (pageIndex = 0)}
						onPreviousPage={() => (pageIndex = 0)}
						onNextPage={() => (pageIndex = 1)}
						onLastPage={() => {
							pageIndex = 1;
						}}
						onPageSizeChange={() => {}}
					>
						{#snippet tableContent()}
							<DataTableView
								{table}
								loading={false}
								error={undefined}
								skeletonRows={0}
								emptyText="No members"
								loadingText="Loading members"
								testIdPrefix="scroll-check"
							/>
						{/snippet}
					</ConvexCursorTableShell>
				</section>
			</div>
		</main>
	</TolgeeProvider>
</Tooltip.Provider>
