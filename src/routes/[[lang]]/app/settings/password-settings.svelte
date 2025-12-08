<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { T } from '@tolgee/svelte';
</script>

<Card.Root>
	<Card.Header>
		<Card.Title><T keyName="settings.password.title" /></Card.Title>
		<Card.Description><T keyName="settings.password.description" /></Card.Description>
	</Card.Header>
	<Card.Content>
		<p class="text-muted-foreground">Password settings coming in Step 8...</p>
	</Card.Content>
</Card.Root>
