<script lang="ts">
	import {
		PromptInput,
		PromptInputAction,
		PromptInputActions,
		PromptInputTextarea
	} from '$lib/components/prompt-kit/prompt-input';
	import { PromptSuggestion } from '$lib/components/prompt-kit/prompt-suggestion';
	import { Button } from '$lib/components/ui/button';
	import { ArrowUp, Camera, Video } from '@lucide/svelte';

	let {
		isScreenshotMode = $bindable(false)
	}: {
		isScreenshotMode?: boolean;
	} = $props();

	let inputValue = $state('');
	let isLoading = $state(false);

	function handleSend() {
		if (inputValue.trim()) {
			isLoading = true;
			console.log('Sending:', inputValue);

			setTimeout(() => {
				inputValue = '';
				isLoading = false;
			}, 1500);
		}
	}

	function handleValueChange(value: string) {
		inputValue = value;
	}

	function handleCameraClick() {
		isScreenshotMode = true;
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
			class="rounded-3xl border border-input bg-background p-0 pt-1 shadow-xs"
			value={inputValue}
			{isLoading}
			onValueChange={handleValueChange}
			onSubmit={handleSend}
		>
			<div class="flex flex-col">
				<PromptInputTextarea
					placeholder="Type a message or click a suggestion..."
					class="min-h-[44px] pt-3 pl-4 text-base leading-[1.3]"
				/>

				<PromptInputActions class="mt-5 flex w-full items-center justify-between gap-2 px-3 pb-3">
					<div class="flex items-center gap-2">
						<PromptInputAction>
							{#snippet tooltip()}
								<p>Mark the bug</p>
							{/snippet}
							<Button
								variant="outline"
								size="icon"
								class="size-9 rounded-full"
								onclick={handleCameraClick}
							>
								<Camera class="h-[18px] w-[18px]" />
							</Button>
						</PromptInputAction>
						<PromptInputAction>
							{#snippet tooltip()}
								<p>Record screen</p>
							{/snippet}
							<Button variant="outline" size="icon" class="size-9 rounded-full">
								<Video class="h-[18px] w-[18px]" />
							</Button>
						</PromptInputAction>
					</div>

					<Button
						size="icon"
						disabled={!inputValue.trim() || isLoading}
						onclick={handleSend}
						class="size-9 rounded-full"
						aria-label="Send"
					>
						{#if !isLoading}
							<ArrowUp class="h-[18px] w-[18px]" />
						{:else}
							<span class="size-3 rounded-xs bg-white"></span>
						{/if}
					</Button>
				</PromptInputActions>
			</div>
		</PromptInput>
	</div>
</div>
