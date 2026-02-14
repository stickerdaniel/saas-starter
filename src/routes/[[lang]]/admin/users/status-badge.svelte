<script lang="ts">
	import { T } from '@tolgee/svelte';

	interface Props {
		banned: boolean;
		emailVerified?: boolean;
		testId?: string;
	}

	let { banned, emailVerified, testId }: Props = $props();
</script>

{#if banned}
	<span
		class="text-destructive-foreground inline-flex items-center rounded-md bg-destructive px-2 py-1 text-xs font-medium ring-1 ring-destructive/20 ring-inset"
		data-testid={testId}
	>
		<T keyName="admin.users.banned" />
	</span>
{:else if emailVerified}
	<span
		class="inline-flex items-center rounded-md border border-green-600 px-2 py-1 text-xs font-medium text-green-600 ring-1 ring-green-600/20 ring-inset"
		data-testid={testId}
	>
		<T keyName="admin.users.verified" />
	</span>
{:else}
	<span
		class="inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border ring-inset"
		data-testid={testId}
	>
		<T keyName="admin.users.unverified" />
	</span>
{/if}
