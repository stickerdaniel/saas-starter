<script lang="ts">
	import {
		PromptInput,
		PromptInputActions,
		PromptInputTextarea
	} from '$lib/components/prompt-kit/prompt-input';
	import { PromptSuggestion } from '$lib/components/prompt-kit/prompt-suggestion';
	import { Button } from '$lib/components/ui/button';
	import { ArrowUp } from '@lucide/svelte';

	let inputValue = $state('');

	function handleSend() {
		if (inputValue.trim()) {
			console.log('Sending:', inputValue);
			inputValue = '';
		}
	}

	function handleValueChange(value: string) {
		inputValue = value;
	}
</script>

<div
	class="right-0 bottom-0 flex h-full w-full origin-bottom-right animate-in flex-col items-center justify-end bg-secondary p-4 shadow-[0_0px_30px_rgba(0,0,0,0.19)] duration-200 ease-out fade-in-0 zoom-in-95 slide-in-from-bottom-4 sm:static sm:h-[700px] sm:w-[410px] sm:rounded-3xl"
>
	<div class="flex w-full flex-col space-y-4">
		<div class="flex flex-wrap gap-2">
			<PromptSuggestion onclick={() => (inputValue = 'I would love to see')}>
				Request a feature
			</PromptSuggestion>

			<PromptSuggestion onclick={() => (inputValue = 'Why Saas Starter?')}>
				Ask a question
			</PromptSuggestion>
			<PromptSuggestion onclick={() => (inputValue = 'I found a bug!')}>
				Report an issue
			</PromptSuggestion>
			<PromptSuggestion onclick={() => (inputValue = 'Help me set up the project.')}>
				Help me with...
			</PromptSuggestion>
		</div>

		<PromptInput
			class="border border-input bg-background shadow-xs"
			value={inputValue}
			onValueChange={handleValueChange}
			onSubmit={handleSend}
		>
			<PromptInputTextarea placeholder="Type a message or click a suggestion..." />
			<PromptInputActions class="justify-end">
				<Button
					size="sm"
					class="size-9 cursor-pointer rounded-full"
					onclick={handleSend}
					disabled={!inputValue.trim()}
					aria-label="Send"
				>
					<ArrowUp class="h-4 w-4" />
				</Button>
			</PromptInputActions>
		</PromptInput>
	</div>
</div>
