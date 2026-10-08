<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';

	interface Props {
		isAdmin: boolean;
	}

	let { isAdmin }: Props = $props();
</script>

<Badge variant={isAdmin ? 'default' : 'secondary'}>
	{#if isAdmin}
		<T keyName="admin.settings.type_admin" />
	{:else}
		<T keyName="admin.settings.type_custom" />
	{/if}
</Badge>
