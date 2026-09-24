<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { cn } from '$lib/utils.js';
	import type { AuditLogItem } from '$lib/convex/admin/auditLog/queries';

	type AuditLogAction = AuditLogItem['action'];

	interface Props {
		action: AuditLogAction;
		testId?: string;
	}

	let { action, testId }: Props = $props();

	type Tone = 'destructive' | 'success' | 'warning' | 'info' | 'primary' | 'neutral';

	// Subtle per-action tints in the app's badge idiom, mirroring the Badge
	// `destructive` variant (/10 fill in light, /20 in dark, colored text). The
	// semantic color still helps scanning the log. stop_impersonation keeps the
	// plain `secondary` variant, which is already subtle.
	const TONES: Record<AuditLogAction, Tone> = {
		ban_user: 'destructive',
		unban_user: 'success',
		revoke_sessions: 'warning',
		impersonate: 'info',
		set_role: 'primary',
		stop_impersonation: 'neutral'
	};

	const tone = $derived(TONES[action]);
</script>

<Badge
	variant="secondary"
	class={cn(
		tone === 'destructive' && 'bg-destructive/10 text-destructive dark:bg-destructive/20',
		tone === 'success' && 'bg-success/10 text-success dark:bg-success/20',
		tone === 'warning' && 'bg-warning/10 text-warning dark:bg-warning/20',
		tone === 'info' && 'bg-info/10 text-info dark:bg-info/20',
		tone === 'primary' && 'bg-primary/10 text-primary dark:bg-primary/20'
	)}
	data-testid={testId}
>
	<T keyName={`admin.audit_log.action.${action}`} />
</Badge>
