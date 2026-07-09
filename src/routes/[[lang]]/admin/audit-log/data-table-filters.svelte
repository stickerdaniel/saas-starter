<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import XIcon from '@lucide/svelte/icons/x';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { T, getTranslate } from '@tolgee/svelte';
	import { useQuery } from 'convex-svelte';
	import { api } from '$lib/convex/_generated/api.js';
	import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';

	const { t } = getTranslate();

	type AuditLogAction = AuditLogItem['action'];

	type Props = {
		actionFilter: AuditLogAction | undefined;
		adminUserId: string | undefined;
		targetUserId: string | undefined;
		onFilterChange: (action: AuditLogAction | undefined) => void;
		onClearUserFilter: () => void;
	};

	let { actionFilter, adminUserId, targetUserId, onFilterChange, onClearUserFilter }: Props =
		$props();

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

	// At most one user filter is ever active (backend applies a single index), so
	// the active id is admin-or-target and its kind picks the chip prefix/label.
	const activeUserId = $derived(adminUserId ?? targetUserId);
	const userFilterKind = $derived(adminUserId ? 'admin' : targetUserId ? 'target' : undefined);

	// Resolve the filtered user's name for the chip. On a deep link the name is
	// not in any visible row, so the chip fetches it; a skeleton shows until it
	// lands. Skipped when no user filter is active.
	const userRefQuery = useQuery(api.admin.auditLog.queries.resolveAuditLogUser, () =>
		activeUserId ? { userId: activeUserId } : 'skip'
	);
	const userLabel = $derived.by(() => {
		const ref = userRefQuery.data;
		if (!ref) return undefined;
		return ref.exists ? (ref.name ?? ref.email ?? ref.id) : ref.id;
	});

	function handleActionChange(value: string) {
		haptic.trigger('light');
		onFilterChange(value === 'all' ? undefined : (value as AuditLogAction));
	}

	function clearFilter() {
		onFilterChange(undefined);
	}

	function clearUserFilter() {
		haptic.trigger('light');
		onClearUserFilter();
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

	{#if userFilterKind}
		<Badge
			variant="secondary"
			class="h-8 gap-1.5 pr-1 pl-2.5"
			data-testid="audit-log-user-filter-chip"
		>
			<span class="text-muted-foreground">
				{userFilterKind === 'admin'
					? $t('admin.audit_log.filter.by')
					: $t('admin.audit_log.filter.against')}
			</span>
			{#if userLabel !== undefined}
				<span class="max-w-[160px] truncate font-medium">{userLabel}</span>
			{:else}
				<Skeleton class="h-3.5 w-20" />
			{/if}
			<button
				type="button"
				onclick={clearUserFilter}
				aria-label={$t('admin.audit_log.filter.remove_user')}
				data-testid="audit-log-user-filter-chip-remove"
				class="flex size-4 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
			>
				<XIcon class="size-3" />
			</button>
		</Badge>
	{/if}
</div>
