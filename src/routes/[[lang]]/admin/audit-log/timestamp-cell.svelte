<script lang="ts">
	import { TruncatedText } from '#lib/components/ui/truncated-text/index.js';

	let { text }: { text: string } = $props();
</script>

<div class="text-sm">
	<TruncatedText {text} />
</div>
