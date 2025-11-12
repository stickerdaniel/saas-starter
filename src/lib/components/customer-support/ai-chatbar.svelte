<script lang="ts">
	import {
		PromptInput,
		PromptInputAction,
		PromptInputActions,
		PromptInputTextarea
	} from '$lib/components/prompt-kit/prompt-input';
	import { Button } from '$lib/components/ui/button/index.js';
	import { ArrowUp, Square } from '@lucide/svelte';

	let input = $state('');
	let isLoading = $state(false);
	let isFocused = $state(false);

	function handleSubmit() {
		isLoading = true;
		// simulate request
		setTimeout(() => {
			isLoading = false;
		}, 2000);
	}

	function handleValueChange(value: string) {
		input = value;
	}

	function handleFocus() {
		isFocused = true;
	}

	function handleBlur() {
		isFocused = false;
	}
</script>

<PromptInput
	value={input}
	onValueChange={handleValueChange}
	{isLoading}
	onSubmit={handleSubmit}
	class="fixed bottom-5 left-1/2 z-100 mb-1 flex w-full -translate-x-1/2 flex-row items-center border-0 !p-1 shadow-2xl outline-2 outline-input transition-all duration-300 ease-in-out md:mb-0 {isFocused
		? 'max-w-[430px]'
		: 'max-w-[280px]'}"
>
	<PromptInputTextarea
		class="!h-auto !min-h-auto !py-0"
		placeholder="Ask me anything..."
		onfocus={handleFocus}
		onblur={handleBlur}
	/>

	<Button
		variant="secondary"
		size="icon"
		class="h-8 w-8 rounded-full text-muted-foreground"
		onclick={handleSubmit}
	>
		{#if isLoading}
			<Square class="size-5 fill-current" />
		{:else}
			<ArrowUp class="size-5" />
		{/if}
	</Button>
</PromptInput>
