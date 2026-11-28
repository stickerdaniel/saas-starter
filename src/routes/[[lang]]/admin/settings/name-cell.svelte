<script lang="ts">
	import { TruncatedText } from '#lib/components/ui/truncated-text/index.js';

	let { name }: { name?: string } = $props();
</script>

<div class={name ? 'text-muted-foreground' : 'text-muted-foreground/50'}>
	<TruncatedText text={name || '-'} />
</div>
