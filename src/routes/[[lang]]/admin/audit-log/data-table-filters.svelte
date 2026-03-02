<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import XIcon from '@tabler/icons-svelte/icons/x';
	import { T, getTranslate } from '@tolgee/svelte';
	import { ADMIN_ACTIONS } from '$lib/convex/admin/types';

	const { t } = getTranslate();

	type Props = {
		eventFilter: string;
		onEventFilterChange: (value: string) => void;
	};

	let { eventFilter, onEventFilterChange }: Props = $props();

	const hasActiveFilters = $derived(eventFilter !== 'all');

	const eventOptions = $derived([
		{ value: 'all', label: $t('admin.audit_log.filter.all_events') },
		...ADMIN_ACTIONS.map((action) => ({
			value: action,
			label: $t(`admin.audit_log.event.${action}`)
		}))
	]);

	function clearFilters() {
		onEventFilterChange('all');
	}
</script>

<div class="flex items-center gap-2">
	<Select.Root type="single" value={eventFilter} onValueChange={onEventFilterChange}>
		<Select.Trigger class="h-8 w-[180px]" data-testid="audit-log-event-filter-trigger">
			{eventOptions.find((opt) => opt.value === eventFilter)?.label ??
				$t('admin.audit_log.filter.all_events')}
		</Select.Trigger>
		<Select.Content>
			{#each eventOptions as option (option.value)}
				<Select.Item value={option.value} data-testid={`audit-log-event-filter-${option.value}`}>
					{option.label}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	{#if hasActiveFilters}
		<Button
			variant="ghost"
			size="sm"
			class="h-8 px-2"
			onclick={clearFilters}
			data-testid="audit-log-filter-clear"
		>
			<XIcon class="mr-1 size-4" />
			<T keyName="admin.audit_log.filter.clear" />
		</Button>
	{/if}
</div>
