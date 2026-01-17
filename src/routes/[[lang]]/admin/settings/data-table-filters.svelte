<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import XIcon from '@tabler/icons-svelte/icons/x';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	type Props = {
		typeFilter: 'all' | 'admin' | 'custom';
		onFilterChange: (filter: 'all' | 'admin' | 'custom') => void;
	};

	let { typeFilter, onFilterChange }: Props = $props();

	// Check if filter is active
	const hasActiveFilter = $derived(typeFilter !== 'all');

	function handleTypeChange(value: string) {
		onFilterChange(value as 'all' | 'admin' | 'custom');
	}

	function clearFilter() {
		onFilterChange('all');
	}

	type TypeOption = { value: 'all' | 'admin' | 'custom'; label: string };
	const typeOptions: TypeOption[] = $derived([
		{ value: 'all', label: $t('admin.settings.filter.all_types') },
		{ value: 'admin', label: $t('admin.settings.filter.admin_only') },
		{ value: 'custom', label: $t('admin.settings.filter.custom_only') }
	]);
</script>

<div class="flex items-center gap-2">
	<!-- Type Filter -->
	<Select.Root type="single" value={typeFilter} onValueChange={handleTypeChange}>
		<Select.Trigger class="h-8 w-[130px]" data-testid="filter-type-trigger">
			{typeOptions.find((opt) => opt.value === typeFilter)?.label ??
				$t('admin.settings.filter.all_types')}
		</Select.Trigger>
		<Select.Content>
			{#each typeOptions as option (option.value)}
				<Select.Item value={option.value} data-testid="filter-{option.value}"
					>{option.label}</Select.Item
				>
			{/each}
		</Select.Content>
	</Select.Root>

	<!-- Clear Filter Button -->
	{#if hasActiveFilter}
		<Button
			variant="ghost"
			size="sm"
			class="h-8 px-2"
			onclick={clearFilter}
			data-testid="filter-clear"
		>
			<XIcon class="mr-1 size-4" />
			<T keyName="admin.settings.filter.clear" />
		</Button>
	{/if}
</div>
