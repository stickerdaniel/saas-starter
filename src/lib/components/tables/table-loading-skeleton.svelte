<script lang="ts">
	import DotsVerticalIcon from '@tabler/icons-svelte/icons/dots-vertical';
	import { getTranslate, T } from '@tolgee/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { TableSkeletonColumn } from './table-loading-skeleton.js';

	const { t } = getTranslate();

	type Props = {
		columns: TableSkeletonColumn[];
		rowCount: number;
		colspan?: number;
		loadingTestId?: string;
		loadingLabelKey?: string;
		rowTestId?: string;
	};

	let {
		columns,
		rowCount,
		colspan = columns.length,
		loadingTestId,
		loadingLabelKey = 'aria.loading',
		rowTestId
	}: Props = $props();

	const rowIndexes = $derived.by(() => Array.from({ length: rowCount }, (_, index) => index));
</script>

{#if loadingTestId}
	<Table.Row data-testid={loadingTestId} class="hidden">
		<Table.Cell {colspan}>
			<T keyName={loadingLabelKey} />
		</Table.Cell>
	</Table.Row>
{/if}

{#each rowIndexes as rowIndex (rowIndex)}
	<Table.Row data-testid={rowTestId}>
		{#each columns as column (column.key)}
			<Table.Cell class={column.cellClass}>
				{#if column.kind === 'checkbox'}
					<div class="flex items-center justify-center">
						<Checkbox disabled aria-label={$t(column.checkboxAriaLabelKey ?? 'aria.loading')} />
					</div>
				{:else if column.kind === 'avatarText'}
					<div class="flex items-center gap-2">
						<Skeleton class="size-8 rounded-full" />
						<Skeleton class={`h-4 ${column.widthClass ?? 'w-20'}`} />
					</div>
				{:else if column.kind === 'badge'}
					<Skeleton class={`h-5 ${column.widthClass ?? 'w-14'} rounded-md`} />
				{:else if column.kind === 'iconButton'}
					<Button variant="ghost" size="icon" disabled>
						<DotsVerticalIcon class="size-4" />
						<span class="sr-only"><T keyName="aria.loading" /></span>
					</Button>
				{:else if column.kind === 'iconButtonGroup'}
					<div class="flex justify-end gap-1">
						{#each Array.from({ length: column.iconCount ?? 3 }) as _item, iconIndex (iconIndex)}
							<Button variant="ghost" size="icon" disabled>
								<DotsVerticalIcon class="size-4" />
								<span class="sr-only"><T keyName="aria.loading" /></span>
							</Button>
						{/each}
					</div>
				{:else if column.kind === 'selectTrigger'}
					<Skeleton class={`h-8 ${column.widthClass ?? 'w-24'} rounded-md`} />
				{:else if column.kind === 'mutedDash'}
					<span class="text-muted-foreground/50">-</span>
				{:else if column.kind === 'empty'}
					<div class="h-8 w-8" aria-hidden="true"></div>
				{:else}
					<Skeleton class={`h-4 ${column.widthClass ?? 'w-24'}`} />
				{/if}
			</Table.Cell>
		{/each}
	</Table.Row>
{/each}
