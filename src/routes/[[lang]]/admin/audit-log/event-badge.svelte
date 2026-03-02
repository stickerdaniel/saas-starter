<script lang="ts">
	import { T } from '@tolgee/svelte';

	interface Props {
		action: string;
		testId?: string;
	}

	let { action, testId }: Props = $props();

	const keyName = $derived(`admin.audit_log.event.${action}`);

	const colorClasses = $derived.by(() => {
		switch (action) {
			case 'ban_user':
				return 'bg-destructive text-destructive-foreground ring-destructive/20';
			case 'unban_user':
				return 'border-green-600 text-green-600 ring-green-600/20';
			case 'set_role':
				return 'bg-primary text-primary-foreground ring-primary/20';
			case 'impersonate':
				return 'bg-amber-100 text-amber-800 ring-amber-500/20 dark:bg-amber-900/30 dark:text-amber-400 dark:ring-amber-500/30';
			case 'stop_impersonation':
				return 'bg-secondary text-secondary-foreground ring-secondary/20';
			case 'revoke_sessions':
				return 'bg-orange-100 text-orange-800 ring-orange-500/20 dark:bg-orange-900/30 dark:text-orange-400 dark:ring-orange-500/30';
			default:
				return 'bg-secondary text-secondary-foreground ring-secondary/20';
		}
	});
</script>

<span
	class="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset {colorClasses}"
	data-testid={testId}
>
	<T {keyName} />
</span>
