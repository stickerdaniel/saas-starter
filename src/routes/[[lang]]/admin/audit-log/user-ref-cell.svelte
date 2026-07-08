<script lang="ts">
	import { T } from '@tolgee/svelte';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';

	interface Props {
		user: AuditLogItem['admin'];
		testId?: string;
	}

	let { user, testId }: Props = $props();

	// Same initials derivation as the users table avatar; '?' for deleted users.
	const initials = $derived(
		user.exists ? (user.name ?? user.email ?? 'U').slice(0, 2).toUpperCase() : '?'
	);
</script>

<div class="flex min-w-0 items-center gap-2" data-testid={testId}>
	<Avatar.Root class="size-8 shrink-0">
		{#if user.exists && user.image}
			<!-- Decorative: the name/email text next to it carries the accessible name -->
			<Avatar.Image src={user.image} alt="" referrerpolicy="no-referrer" />
		{/if}
		<Avatar.Fallback class="text-xs">{initials}</Avatar.Fallback>
	</Avatar.Root>
	<div class="min-w-0">
		{#if user.exists}
			<div class="truncate font-medium">{user.name ?? user.email ?? user.id}</div>
			{#if user.name && user.email}
				<div class="truncate text-xs text-muted-foreground">{user.email}</div>
			{/if}
		{:else}
			<div class="truncate font-mono text-xs text-muted-foreground">{user.id}</div>
			<div class="text-xs text-muted-foreground italic">
				<T keyName="admin.audit_log.deleted_user" />
			</div>
		{/if}
	</div>
</div>
