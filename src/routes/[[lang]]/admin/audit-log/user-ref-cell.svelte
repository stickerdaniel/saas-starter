<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';

	interface Props {
		/** Absent while the table loads: the cell renders its skeleton. */
		user?: AuditLogItem['admin'];
		kind?: 'admin' | 'target';
		onFilter?: () => void;
		testId?: string;
	}

	let { user, kind, onFilter, testId }: Props = $props();

	const { t } = getTranslate();

	// Same initials derivation as the users table avatar; '?' for deleted users.
	const initials = $derived(
		user?.exists ? (user.name ?? user.email ?? 'U').slice(0, 2).toUpperCase() : '?'
	);

	const displayName = $derived(user ? (user.name ?? user.email ?? user.id) : '');
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

{#snippet content(user: AuditLogItem['admin'])}
	<Avatar.Root class="shrink-0">
		{#if user.exists && user.image}
			<!-- Decorative: the name/email text next to it carries the accessible name -->
			<Avatar.Image src={user.image} alt="" referrerpolicy="no-referrer" />
		{/if}
		<Avatar.Fallback size="xs">{initials}</Avatar.Fallback>
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

{#if !user}
	<!-- The interactive branch's padded button, so the skeleton row matches its
	     height: two lines beside the avatar plus the button border. `inert` rather
	     than `disabled` keeps the skeleton at full opacity. -->
	<Button
		variant="ghost"
		type="button"
		inert
		aria-hidden="true"
		class="flex h-auto w-full min-w-0 items-center justify-start gap-2 rounded-md text-left font-normal whitespace-normal shadow-none"
	>
		<Skeleton class="size-8 shrink-0 rounded-full" />
		<div class="min-w-0">
			<div class="flex h-5 items-center"><Skeleton class="h-4 w-24" /></div>
			<div class="flex h-4 items-center"><Skeleton class="h-3 w-32" /></div>
		</div>
	</Button>
{:else if onFilter}
	<Button
		variant="ghost"
		type="button"
		onclick={onFilter}
		aria-label={filterLabel}
		data-testid={testId}
		class="group flex h-auto w-full min-w-0 cursor-pointer items-center justify-start gap-2 rounded-md text-left font-normal whitespace-normal shadow-none active:translate-y-0"
	>
		{@render content(user)}
	</Button>
{:else}
	<div class="group flex min-w-0 items-center gap-2" data-testid={testId}>
		{@render content(user)}
	</div>
{/if}
