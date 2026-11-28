<script lang="ts">
	import { TruncatedText } from '#lib/components/ui/truncated-text/index.js';

	let { email }: { email: string } = $props();
</script>

<div class="font-medium">
	<TruncatedText text={email} />
</div>
