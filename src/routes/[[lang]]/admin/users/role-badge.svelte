<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';

	interface Props {
		role: string;
		testId?: string;
	}

	let { role, testId }: Props = $props();

	let isAdmin = $derived(role === 'admin');
</script>

<Badge variant={isAdmin ? 'default' : 'secondary'} data-testid={testId}>
	{#if isAdmin}
		<T keyName="admin.users.filter.role_admin" />
	{:else}
		<T keyName="admin.users.filter.role_user" />
	{/if}
</Badge>
