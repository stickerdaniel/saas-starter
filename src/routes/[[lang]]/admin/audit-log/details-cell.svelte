<script lang="ts">
	import { T } from '@tolgee/svelte';
	import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';

	interface Props {
		metadata: AuditLogItem['metadata'];
		testId?: string;
	}

	let { metadata, testId }: Props = $props();

	const reason = $derived(metadata && 'reason' in metadata ? metadata.reason : undefined);
	const roleChange = $derived(
		metadata && 'newRole' in metadata
			? { previousRole: metadata.previousRole, newRole: metadata.newRole }
			: undefined
	);
</script>

<div class="min-w-0 text-sm" data-testid={testId}>
	{#if reason}
		<span class="text-muted-foreground">{reason}</span>
	{:else if roleChange}
		<span class="text-muted-foreground">
			<T
				keyName="admin.audit_log.details.role_change"
				params={{ previousRole: roleChange.previousRole, newRole: roleChange.newRole }}
			/>
		</span>
	{:else}
		<span class="text-muted-foreground/50">-</span>
	{/if}
</div>
