<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';

	type AuditLogAction = AuditLogItem['action'];

	interface Props {
		action: AuditLogAction;
		testId?: string;
	}

	let { action, testId }: Props = $props();

	// Subtle per-action tints in the app's badge idiom, mirroring the Badge
	// `destructive` variant (/10 fill in light, /20 in dark, colored text). The
	// semantic color still helps scanning the log. stop_impersonation keeps the
	// plain `secondary` variant, which is already subtle.
	const TINTS: Record<AuditLogAction, string> = {
		ban_user: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
		unban_user: 'bg-success/10 text-success dark:bg-success/20',
		revoke_sessions: 'bg-warning/10 text-warning dark:bg-warning/20',
		impersonate: 'bg-info/10 text-info dark:bg-info/20',
		set_role: 'bg-primary/10 text-primary dark:bg-primary/20',
		stop_impersonation: ''
	};

	const tint = $derived(TINTS[action]);
</script>

<Badge variant="secondary" class={tint} data-testid={testId}>
	<T keyName={`admin.audit_log.action.${action}`} />
</Badge>
