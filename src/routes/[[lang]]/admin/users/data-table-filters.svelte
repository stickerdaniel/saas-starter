<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import XIcon from '@tabler/icons-svelte/icons/x';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { T, getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	type ProviderFilter = 'credential' | 'google' | 'github' | 'passkey';

	type Props = {
		roleFilter: string | undefined;
		statusFilter: 'verified' | 'unverified' | 'banned' | undefined;
		providerFilter: ProviderFilter | undefined;
		onFilterChange: (filters: {
			role: string | undefined;
			status: 'verified' | 'unverified' | 'banned' | undefined;
			provider: ProviderFilter | undefined;
		}) => void;
	};

	let { roleFilter, statusFilter, providerFilter, onFilterChange }: Props = $props();

	// Convert undefined to 'all' for display
	const roleValue = $derived(roleFilter ?? 'all');
	const statusValue = $derived(statusFilter ?? 'all');
	const providerValue = $derived(providerFilter ?? 'all');

	// Check if any filters are active
	const hasActiveFilters = $derived(
		roleFilter !== undefined || statusFilter !== undefined || providerFilter !== undefined
	);

	function handleRoleChange(value: string) {
		haptic.trigger('light');
		onFilterChange({
			role: value === 'all' ? undefined : value,
			status: statusFilter,
			provider: providerFilter
		});
	}

	function handleStatusChange(value: string) {
		haptic.trigger('light');
		onFilterChange({
			role: roleFilter,
			status: value === 'all' ? undefined : (value as 'verified' | 'unverified' | 'banned'),
			provider: providerFilter
		});
	}

	function handleProviderChange(value: string) {
		haptic.trigger('light');
		onFilterChange({
			role: roleFilter,
			status: statusFilter,
			provider: value === 'all' ? undefined : (value as ProviderFilter)
		});
	}

	function clearFilters() {
		onFilterChange({
			role: undefined,
			status: undefined,
			provider: undefined
		});
	}

	const roleOptions = $derived([
		{ value: 'all', label: $t('admin.users.filter.all_roles') },
		{ value: 'admin', label: $t('admin.users.filter.role_admin') },
		{ value: 'user', label: $t('admin.users.filter.role_user') }
	]);

	const statusOptions = $derived([
		{ value: 'all', label: $t('admin.users.filter.all_status') },
		{ value: 'verified', label: $t('admin.users.filter.status_verified') },
		{ value: 'unverified', label: $t('admin.users.filter.status_unverified') },
		{ value: 'banned', label: $t('admin.users.filter.status_banned') }
	]);

	const providerOptions = $derived([
		{ value: 'all', label: $t('admin.users.filter.all_providers') },
		{ value: 'credential', label: $t('admin.users.filter.provider_email') },
		{ value: 'google', label: $t('admin.users.filter.provider_google') },
		{ value: 'github', label: $t('admin.users.filter.provider_github') },
		{ value: 'passkey', label: $t('admin.users.filter.provider_passkey') }
	]);
</script>

<div class="flex items-center gap-2">
	<!-- Role Filter -->
	<Select.Root type="single" value={roleValue} onValueChange={handleRoleChange}>
		<Select.Trigger class="h-8 w-[130px]" data-testid="admin-users-role-filter-trigger">
			{roleOptions.find((opt) => opt.value === roleValue)?.label ??
				$t('admin.users.filter.all_roles')}
		</Select.Trigger>
		<Select.Content>
			{#each roleOptions as option (option.value)}
				<Select.Item value={option.value} data-testid={`admin-users-role-filter-${option.value}`}>
					{option.label}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<!-- Status Filter -->
	<Select.Root type="single" value={statusValue} onValueChange={handleStatusChange}>
		<Select.Trigger class="h-8 w-[130px]" data-testid="admin-users-status-filter-trigger">
			{statusOptions.find((opt) => opt.value === statusValue)?.label ??
				$t('admin.users.filter.all_status')}
		</Select.Trigger>
		<Select.Content>
			{#each statusOptions as option (option.value)}
				<Select.Item value={option.value} data-testid={`admin-users-status-filter-${option.value}`}>
					{option.label}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<!-- Provider Filter -->
	<Select.Root type="single" value={providerValue} onValueChange={handleProviderChange}>
		<Select.Trigger class="h-8 w-[130px]" data-testid="admin-users-provider-filter-trigger">
			{providerOptions.find((opt) => opt.value === providerValue)?.label ??
				$t('admin.users.filter.all_providers')}
		</Select.Trigger>
		<Select.Content>
			{#each providerOptions as option (option.value)}
				<Select.Item
					value={option.value}
					data-testid={`admin-users-provider-filter-${option.value}`}
				>
					{option.label}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<!-- Clear Filters Button -->
	{#if hasActiveFilters}
		<Button
			variant="ghost"
			size="sm"
			class="h-8 px-2"
			onclick={clearFilters}
			data-testid="admin-users-filter-clear"
		>
			<XIcon class="mr-1 size-4" />
			<T keyName="admin.users.filter.clear" />
		</Button>
	{/if}
</div>
