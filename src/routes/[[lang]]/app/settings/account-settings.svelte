<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { T } from '@tolgee/svelte';

	interface Props {
		user: {
			name?: string;
			email?: string;
			image?: string | null;
		} | null;
	}

	let { user }: Props = $props();
</script>

<Card.Root>
	<Card.Header>
		<Card.Title><T keyName="settings.account.title" /></Card.Title>
		<Card.Description><T keyName="settings.account.description" /></Card.Description>
	</Card.Header>
	<Card.Content>
		<p class="text-muted-foreground">Account settings coming in Step 6...</p>
	</Card.Content>
</Card.Root>
