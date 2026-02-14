<script lang="ts">
	import type { Column } from '@tanstack/table-core';
	import ArrowUpIcon from '@tabler/icons-svelte/icons/arrow-up';
	import ArrowDownIcon from '@tabler/icons-svelte/icons/arrow-down';
	import ArrowsVerticalIcon from '@tabler/icons-svelte/icons/arrows-sort';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { NotificationRecipient } from '$lib/convex/admin/notificationPreferences/queries';
	import { T } from '@tolgee/svelte';

	type Props = {
		titleKey: string;
		column?: Column<NotificationRecipient, unknown>;
		class?: string;
		testId?: string;
	};

	let { titleKey, column, class: className = '', testId }: Props = $props();

	const canSort = $derived(column?.getCanSort() ?? false);
	const sorted = $derived(column?.getIsSorted() ?? false);
</script>

{#if canSort && column}
	<Button
		variant="ghost"
		size="sm"
		class={`-ml-3 h-8 data-[state=open]:bg-accent ${className}`.trim()}
		onclick={column.getToggleSortingHandler()}
		data-testid={testId}
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
	<div class={className}>
		<T keyName={titleKey} />
	</div>
{/if}
