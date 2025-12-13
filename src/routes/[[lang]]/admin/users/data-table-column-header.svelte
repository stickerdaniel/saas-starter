<script lang="ts">
	import type { Column } from '@tanstack/table-core';
	import ArrowUpIcon from '@tabler/icons-svelte/icons/arrow-up';
	import ArrowDownIcon from '@tabler/icons-svelte/icons/arrow-down';
	import ArrowsVerticalIcon from '@tabler/icons-svelte/icons/arrows-sort';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { AdminUserData } from '$lib/convex/admin/types';
	import { T } from '@tolgee/svelte';

	type Props = {
		column: Column<AdminUserData, unknown>;
		titleKey: string;
	};

	let { column, titleKey }: Props = $props();

	const canSort = $derived(column.getCanSort());
	const sorted = $derived(column.getIsSorted());
</script>

{#if canSort}
	<Button
		variant="ghost"
		size="sm"
		class="-ml-3 h-8 data-[state=open]:bg-accent"
		onclick={column.getToggleSortingHandler()}
	>
		<span><T keyName={titleKey} /></span>
		{#if sorted === 'desc'}
			<ArrowDownIcon class="ml-2 size-4" />
		{:else if sorted === 'asc'}
			<ArrowUpIcon class="ml-2 size-4" />
		{:else}
			<ArrowsVerticalIcon class="ml-2 size-4" />
		{/if}
	</Button>
{:else}
	<div><T keyName={titleKey} /></div>
{/if}
