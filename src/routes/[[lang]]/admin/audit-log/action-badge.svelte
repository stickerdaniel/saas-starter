<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge/index.js';
	import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';

	type AuditLogAction = AuditLogItem['action'];

	interface Props {
		action: AuditLogAction;
		testId?: string;
	}

	let { action, testId }: Props = $props();

	// Subtle per-action tints in the app's badge idiom (/10 fill in light, /20 in
	// dark, colored text). The semantic color still helps scanning the log.
	// stop_impersonation keeps the plain `secondary` variant, which is already subtle.
	const VARIANTS: Record<AuditLogAction, BadgeVariant> = {
		ban_user: 'destructive',
		unban_user: 'success',
		revoke_sessions: 'warning',
		impersonate: 'info',
		set_role: 'primary-subtle',
		stop_impersonation: 'secondary'
	};

	const variant = $derived(VARIANTS[action]);
</script>

<Badge {variant} data-testid={testId}>
	<T keyName={`admin.audit_log.action.${action}`} />
</Badge>
