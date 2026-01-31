<script lang="ts">
	import { T } from '@tolgee/svelte';

	interface Props {
		role: string;
	}

	let { role }: Props = $props();

	let isAdmin = $derived(role === 'admin');
</script>

<span
	class="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset {isAdmin
		? 'bg-primary text-primary-foreground ring-primary/20'
		: 'bg-secondary text-secondary-foreground ring-secondary/20'}"
>
	{#if isAdmin}
		<T keyName="admin.users.filter.role_admin" />
	{:else}
		<T keyName="admin.users.filter.role_user" />
	{/if}
</span>
