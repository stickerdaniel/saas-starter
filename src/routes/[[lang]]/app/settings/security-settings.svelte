<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { T } from '@tolgee/svelte';
</script>

<Card.Root>
	<Card.Header>
		<Card.Title><T keyName="settings.security.title" /></Card.Title>
		<Card.Description><T keyName="settings.security.description" /></Card.Description>
	</Card.Header>
	<Card.Content>
		<p class="text-muted-foreground">Security settings (passkeys) coming in Step 10...</p>
	</Card.Content>
</Card.Root>
