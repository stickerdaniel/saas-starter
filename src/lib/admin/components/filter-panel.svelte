<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import type { FilterDefinition } from '$lib/admin/types';
	import DateRangeFilter from './date-range-filter.svelte';
	import NumberRangeFilter from './number-range-filter.svelte';

	type Props = {
		prefix: string;
		filters: FilterDefinition[];
		values: Record<string, string>;
		onFilterChange: (key: string, value: string) => void;
		onClear: () => void;
	};

	let { prefix, filters, values, onFilterChange, onClear }: Props = $props();

	const { t } = getTranslate();
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
		{:else if filter.type === 'number-range'}
			<NumberRangeFilter
				labelKey={filter.labelKey}
				value={values[filter.urlKey] ?? filter.defaultValue}
				testId={`${prefix}-${filter.key}-filter`}
				onChange={(nextValue) => onFilterChange(filter.urlKey, nextValue)}
			/>
		{:else if filter.type === 'select' && filter.searchable}
			{@const currentValue = values[filter.urlKey] ?? filter.defaultValue}
			{@const selectedLabel = filter.options.find((o) => o.value === currentValue)}
			<Popover.Root>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							role="combobox"
							class="min-w-40 justify-between"
							data-testid={`${prefix}-${filter.key}-filter-trigger`}
						>
							{#if selectedLabel && currentValue !== filter.defaultValue}
								<T keyName={selectedLabel.labelKey} />
							{:else}
								<T keyName={filter.labelKey} />
							{/if}
							<ChevronsUpDownIcon class="ml-2 size-4 shrink-0 opacity-50" />
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content class="w-[var(--bits-popover-trigger-width)] p-0" sideOffset={4}>
					<Command.Root>
						<Command.Input placeholder={$t(filter.labelKey)} />
						<Command.List class="max-h-[200px]">
							<Command.Empty>
								<T keyName="admin.resources.filters.no_results" />
							</Command.Empty>
							<Command.Group>
								{#each filter.options as option (option.value)}
									<Command.Item
										value={$t(option.labelKey)}
										onSelect={() => onFilterChange(filter.urlKey, option.value)}
										data-testid={`${prefix}-${filter.key}-filter-${option.value}`}
									>
										<CheckIcon
											class="mr-2 size-4 {currentValue === option.value
												? 'opacity-100'
												: 'opacity-0'}"
										/>
										<T keyName={option.labelKey} />
									</Command.Item>
								{/each}
							</Command.Group>
						</Command.List>
					</Command.Root>
				</Popover.Content>
			</Popover.Root>
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
