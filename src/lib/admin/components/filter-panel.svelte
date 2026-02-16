<script lang="ts">
	import { T } from '@tolgee/svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { FilterDefinition } from '$lib/admin/types';
	import DateRangeFilter from './date-range-filter.svelte';

	type Props = {
		prefix: string;
		filters: FilterDefinition[];
		values: Record<string, string>;
		onFilterChange: (key: string, value: string) => void;
		onClear: () => void;
	};

	let { prefix, filters, values, onFilterChange, onClear }: Props = $props();
</script>

<div class="flex flex-wrap items-center gap-2">
	{#each filters as filter (filter.key)}
		{#if filter.type === 'date-range'}
			<DateRangeFilter
				labelKey={filter.labelKey}
				value={values[filter.urlKey] ?? filter.defaultValue}
				testId={`${prefix}-${filter.key}-filter`}
				onChange={(nextValue) => onFilterChange(filter.urlKey, nextValue)}
			/>
		{:else}
			<Select.Root
				type="single"
				value={values[filter.urlKey] ?? filter.defaultValue}
				onValueChange={(value) => onFilterChange(filter.urlKey, value)}
			>
				<Select.Trigger data-testid={`${prefix}-${filter.key}-filter-trigger`} class="min-w-40">
					{#if values[filter.urlKey] && values[filter.urlKey] !== filter.defaultValue}
						{#each filter.options as option (option.value)}
							{#if option.value === values[filter.urlKey]}
								<T keyName={option.labelKey} />
							{/if}
						{/each}
					{:else}
						<T keyName={filter.labelKey} />
					{/if}
				</Select.Trigger>
				<Select.Content>
					{#each filter.options as option (option.value)}
						<Select.Item
							value={option.value}
							data-testid={`${prefix}-${filter.key}-filter-${option.value}`}
						>
							<T keyName={option.labelKey} />
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
	{/each}

	<Button variant="outline" size="sm" onclick={onClear} data-testid={`${prefix}-filter-clear`}>
		<T keyName="admin.resources.filters.clear" />
	</Button>
</div>
