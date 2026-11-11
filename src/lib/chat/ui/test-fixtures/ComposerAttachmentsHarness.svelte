<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import {
		PromptInput,
		PromptInputTextarea
	} from '#lib/components/prompt-kit/prompt-input/index.ts';
	import ChatAttachments from '../ChatAttachments.svelte';

	let props: ComponentProps<typeof ChatAttachments> = $props();
</script>

<!-- Attachments inside the composer shell, as ChatInput nests them. -->
<PromptInput>
	<ChatAttachments {...props} />
	<PromptInputTextarea />
</PromptInput>
