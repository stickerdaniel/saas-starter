<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';

	interface Props {
		user: AuditLogItem['admin'];
		kind?: 'admin' | 'target';
		onFilter?: () => void;
		testId?: string;
	}

	let { user, kind, onFilter, testId }: Props = $props();

	const { t } = getTranslate();

	// Same initials derivation as the users table avatar; '?' for deleted users.
	const initials = $derived(
		user.exists ? (user.name ?? user.email ?? 'U').slice(0, 2).toUpperCase() : '?'
	);

	const displayName = $derived(user.name ?? user.email ?? user.id);
	const filterLabel = $derived(
		$t(
			kind === 'target'
				? 'admin.audit_log.filter.aria_target'
				: 'admin.audit_log.filter.aria_admin',
			{
				name: displayName
			}
		)
	);
</script>

{#snippet content()}
	<Avatar.Root class="size-8 shrink-0">
		{#if user.exists && user.image}
			<!-- Decorative: the name/email text next to it carries the accessible name -->
			<Avatar.Image src={user.image} alt="" referrerpolicy="no-referrer" />
		{/if}
		<Avatar.Fallback class="text-xs">{initials}</Avatar.Fallback>
	</Avatar.Root>
	<div class="min-w-0">
		{#if user.exists}
			<div class="truncate font-medium group-hover:underline group-focus-visible:underline">
				{displayName}
			</div>
			{#if user.name && user.email}
				<div class="truncate text-xs text-muted-foreground">{user.email}</div>
			{/if}
		{:else}
			<div
				class="truncate font-mono text-xs text-muted-foreground group-hover:underline group-focus-visible:underline"
			>
				{user.id}
			</div>
			<div class="text-xs text-muted-foreground italic">
				<T keyName="admin.audit_log.deleted_user" />
			</div>
		{/if}
	</div>
{/snippet}

{#if onFilter}
	<button
		type="button"
		onclick={onFilter}
		aria-label={filterLabel}
		data-testid={testId}
		class="group flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
	>
		{@render content()}
	</button>
{:else}
	<div class="group flex min-w-0 items-center gap-2" data-testid={testId}>
		{@render content()}
	</div>
{/if}
