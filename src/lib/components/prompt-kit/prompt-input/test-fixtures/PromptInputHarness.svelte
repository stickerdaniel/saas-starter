<script lang="ts">
	import { PromptInput, PromptInputTextarea } from '../index.ts';

	let { onSubmit }: { onSubmit: () => void } = $props();
</script>

<PromptInput {onSubmit}>
	<PromptInputTextarea />
</PromptInput>
