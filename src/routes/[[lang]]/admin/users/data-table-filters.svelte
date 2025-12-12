<script lang="ts">
	import type { Table } from '@tanstack/table-core';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import FilterIcon from '@tabler/icons-svelte/icons/filter';
	import XIcon from '@tabler/icons-svelte/icons/x';
	import type { AdminUserData } from '$lib/convex/admin/types';

	type Props = {
		table: Table<AdminUserData>;
	};

	let { table }: Props = $props();

	// Get current filter values
	let roleFilter = $derived(
		(table.getColumn('role')?.getFilterValue() as string | undefined) ?? 'all'
	);
	let statusFilter = $derived(
		(table.getColumn('status')?.getFilterValue() as string | undefined) ?? 'all'
	);

	// Check if any filters are active
	const hasActiveFilters = $derived(roleFilter !== 'all' || statusFilter !== 'all');

	function handleRoleChange(value: string) {
		table.getColumn('role')?.setFilterValue(value === 'all' ? undefined : value);
	}

	function handleStatusChange(value: string) {
		table.getColumn('status')?.setFilterValue(value === 'all' ? undefined : value);
	}

	function clearFilters() {
		table.getColumn('role')?.setFilterValue(undefined);
		table.getColumn('status')?.setFilterValue(undefined);
	}

	const roleOptions = [
		{ value: 'all', label: 'All Roles' },
		{ value: 'admin', label: 'Admin' },
		{ value: 'user', label: 'User' }
	];

	const statusOptions = [
		{ value: 'all', label: 'All Status' },
		{ value: 'verified', label: 'Verified' },
		{ value: 'unverified', label: 'Unverified' },
		{ value: 'banned', label: 'Banned' }
	];
</script>

<div class="flex items-center gap-2">
	<FilterIcon class="size-4 text-muted-foreground" />

	<!-- Role Filter -->
	<Select.Root type="single" value={roleFilter} onValueChange={handleRoleChange}>
		<Select.Trigger class="h-8 w-[130px]">
			{roleOptions.find((opt) => opt.value === roleFilter)?.label ?? 'All Roles'}
		</Select.Trigger>
		<Select.Content>
			{#each roleOptions as option (option.value)}
				<Select.Item value={option.value}>{option.label}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<!-- Status Filter -->
	<Select.Root type="single" value={statusFilter} onValueChange={handleStatusChange}>
		<Select.Trigger class="h-8 w-[130px]">
			{statusOptions.find((opt) => opt.value === statusFilter)?.label ?? 'All Status'}
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
			Clear
		</Button>
	{/if}
</div>
