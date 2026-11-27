<script lang="ts">
	import LazyToaster from '#lib/components/ui/sonner/lazy-toaster.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import { Streamdown } from 'svelte-streamdown';

	const content = '| Plan | Seats |\n| --- | --- |\n| Starter | 3 |\n| Team | 20 |';
</script>

<LazyToaster />
<main class="space-y-6 p-8">
	<Button onclick={() => toast('Changes saved', { duration: Number.POSITIVE_INFINITY })}>
		Show toast
	</Button>
	<Streamdown {content} baseTheme="shadcn" />
</main>
