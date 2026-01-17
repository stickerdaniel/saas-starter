<script lang="ts">
	import { T } from '@tolgee/svelte';

	interface Props {
		isAdmin: boolean;
	}

	let { isAdmin }: Props = $props();
</script>

{#if isAdmin}
	<span
		class="inline-flex items-center rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground ring-1 ring-primary/20 ring-inset"
	>
		<T keyName="admin.settings.type_admin" />
	</span>
{:else}
	<span
		class="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground ring-1 ring-secondary/20 ring-inset"
	>
		<T keyName="admin.settings.type_custom" />
	</span>
{/if}
