<script lang="ts">
	import ArrowUpIcon from '@tabler/icons-svelte/icons/arrow-up';
	import ArrowDownIcon from '@tabler/icons-svelte/icons/arrow-down';
	import ArrowsVerticalIcon from '@tabler/icons-svelte/icons/arrows-sort';
	import { T } from '@tolgee/svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	type SortState = 'asc' | 'desc' | null;

	type Props = {
		titleKey: string;
		sortable?: boolean;
		sorted?: SortState;
		onToggleSort?: () => void;
		class?: string;
		testId?: string;
	};

	let {
		titleKey,
		sortable = false,
		sorted = null,
		onToggleSort,
		class: className = '',
		testId
	}: Props = $props();
</script>

{#if sortable && onToggleSort}
	<Button
		variant="ghost"
		size="sm"
		class={`-ml-3 h-8 data-[state=open]:bg-accent ${className}`.trim()}
		onclick={onToggleSort}
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
