<script lang="ts">
	// Imported before Streamdown so Sonner's stylesheet loads first, as the root layout's
	// Toaster does on an app page that renders Markdown. Sonner's toast rule has the same
	// specificity as Streamdown's fullscreen rule, so the later stylesheet decides.
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import { Streamdown } from 'svelte-streamdown';

	const content = '| Plan | Seats |\n| --- | --- |\n| Starter | 3 |\n| Team | 20 |';
</script>

<Toaster />
<main class="space-y-6 p-8">
	<Button onclick={() => toast('Changes saved', { duration: Number.POSITIVE_INFINITY })}>
		Show toast
	</Button>
	<Streamdown {content} baseTheme="shadcn" />
</main>
