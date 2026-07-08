<script lang="ts">
	import { T } from '@tolgee/svelte';
	import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';

	interface Props {
		user: AuditLogItem['admin'];
		testId?: string;
	}

	let { user, testId }: Props = $props();
</script>

{#if user.exists}
	<div class="min-w-0" data-testid={testId}>
		<div class="truncate font-medium">{user.name ?? user.email ?? user.id}</div>
		{#if user.name && user.email}
			<div class="truncate text-xs text-muted-foreground">{user.email}</div>
		{/if}
	</div>
{:else}
	<div class="min-w-0" data-testid={testId}>
		<div class="truncate font-mono text-xs text-muted-foreground">{user.id}</div>
		<div class="text-xs text-muted-foreground italic">
			<T keyName="admin.audit_log.deleted_user" />
		</div>
	</div>
{/if}
