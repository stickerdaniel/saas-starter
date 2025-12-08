<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { T } from '@tolgee/svelte';

	interface Props {
		user: {
			email?: string;
			emailVerified?: boolean;
		} | null;
	}

	let { user }: Props = $props();
</script>

<Card.Root>
	<Card.Header>
		<Card.Title><T keyName="settings.email.title" /></Card.Title>
		<Card.Description><T keyName="settings.email.description" /></Card.Description>
	</Card.Header>
	<Card.Content>
		<p class="text-muted-foreground">Email settings coming in Step 9...</p>
	</Card.Content>
</Card.Root>
