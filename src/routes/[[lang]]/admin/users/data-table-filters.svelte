<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import XIcon from '@tabler/icons-svelte/icons/x';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	type Props = {
		roleFilter: string | undefined;
		statusFilter: 'verified' | 'unverified' | 'banned' | undefined;
		onFilterChange: (filters: {
			role: string | undefined;
			status: 'verified' | 'unverified' | 'banned' | undefined;
		}) => void;
	};

	let { roleFilter, statusFilter, onFilterChange }: Props = $props();

	// Convert undefined to 'all' for display
	const roleValue = $derived(roleFilter ?? 'all');
	const statusValue = $derived(statusFilter ?? 'all');

	// Check if any filters are active
	const hasActiveFilters = $derived(roleFilter !== undefined || statusFilter !== undefined);

	function handleRoleChange(value: string) {
		onFilterChange({
			role: value === 'all' ? undefined : value,
			status: statusFilter
		});
	}

	function handleStatusChange(value: string) {
		onFilterChange({
			role: roleFilter,
			status: value === 'all' ? undefined : (value as 'verified' | 'unverified' | 'banned')
		});
	}

	function clearFilters() {
		onFilterChange({
			role: undefined,
			status: undefined
		});
	}

	const roleOptions = $derived([
		{ value: 'all', label: $t('admin.users.filter.all_roles') },
		{ value: 'admin', label: 'admin' },
		{ value: 'user', label: 'user' }
	]);

	const statusOptions = $derived([
		{ value: 'all', label: $t('admin.users.filter.all_status') },
		{ value: 'verified', label: 'Verified' },
		{ value: 'unverified', label: 'Unverified' },
		{ value: 'banned', label: 'Banned' }
	]);
</script>

<div class="flex items-center gap-2">
	<!-- Role Filter -->
	<Select.Root type="single" value={roleValue} onValueChange={handleRoleChange}>
		<Select.Trigger class="h-8 w-[130px]">
			{roleOptions.find((opt) => opt.value === roleValue)?.label ??
				$t('admin.users.filter.all_roles')}
		</Select.Trigger>
		<Select.Content>
			{#each roleOptions as option (option.value)}
				<Select.Item value={option.value}>{option.label}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<!-- Status Filter -->
	<Select.Root type="single" value={statusValue} onValueChange={handleStatusChange}>
		<Select.Trigger class="h-8 w-[130px]">
			{statusOptions.find((opt) => opt.value === statusValue)?.label ??
				$t('admin.users.filter.all_status')}
		</Select.Trigger>
		<Select.Content>
			{#each statusOptions as option (option.value)}
				<Select.Item value={option.value}>{option.label}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<!-- Clear Filters Button -->
	{#if hasActiveFilters}
		<Button variant="ghost" size="sm" class="h-8 px-2" onclick={clearFilters}>
			<XIcon class="mr-1 size-4" />
			<T keyName="admin.users.filter.clear" />
		</Button>
	{/if}
</div>
