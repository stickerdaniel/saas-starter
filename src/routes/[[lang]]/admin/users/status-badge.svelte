<script lang="ts">
	import { T } from '@tolgee/svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';

	interface Props {
		banned: boolean;
		emailVerified?: boolean;
		testId?: string;
	}

	let { banned, emailVerified, testId }: Props = $props();
</script>

{#if banned}
	<Badge variant="destructive" data-testid={testId}>
		<T keyName="admin.users.banned" />
	</Badge>
{:else if emailVerified}
	<Badge variant="bordered-success" data-testid={testId}>
		<T keyName="admin.users.verified" />
	</Badge>
{:else}
	<Badge variant="outline" data-testid={testId}>
		<T keyName="admin.users.unverified" />
	</Badge>
{/if}
