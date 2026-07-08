<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import XIcon from '@lucide/svelte/icons/x';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { T, getTranslate } from '@tolgee/svelte';
	import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';

	const { t } = getTranslate();

	type AuditLogAction = AuditLogItem['action'];

	type Props = {
		actionFilter: AuditLogAction | undefined;
		onFilterChange: (action: AuditLogAction | undefined) => void;
	};

	let { actionFilter, onFilterChange }: Props = $props();

	const ACTIONS: AuditLogAction[] = [
		'impersonate',
		'stop_impersonation',
		'ban_user',
		'unban_user',
		'revoke_sessions',
		'set_role'
	];

	const actionValue = $derived(actionFilter ?? 'all');
	const hasActiveFilter = $derived(actionFilter !== undefined);

	function handleActionChange(value: string) {
		haptic.trigger('light');
		onFilterChange(value === 'all' ? undefined : (value as AuditLogAction));
	}

	function clearFilter() {
		onFilterChange(undefined);
	}

	const options = $derived([
		{ value: 'all', label: $t('admin.audit_log.filter.all_actions') },
		...ACTIONS.map((action) => ({
			value: action,
			label: $t(`admin.audit_log.action.${action}`)
		}))
	]);
</script>

<div class="flex items-center gap-2">
	<Select.Root type="single" value={actionValue} onValueChange={handleActionChange}>
		<Select.Trigger class="h-8 w-[180px]" data-testid="admin-audit-log-action-filter">
			{options.find((opt) => opt.value === actionValue)?.label ??
				$t('admin.audit_log.filter.all_actions')}
		</Select.Trigger>
		<Select.Content>
			{#each options as option (option.value)}
				<Select.Item
					value={option.value}
					data-testid={`admin-audit-log-action-filter-${option.value}`}
				>
					{option.label}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	{#if hasActiveFilter}
		<Button
			variant="ghost"
			size="sm"
			class="h-8 px-2"
			onclick={clearFilter}
			data-testid="admin-audit-log-filter-clear"
		>
			<XIcon class="mr-1 size-4" />
			<T keyName="admin.audit_log.filter.clear" />
		</Button>
	{/if}
</div>
