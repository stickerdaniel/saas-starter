<script lang="ts">
	import type { Snippet } from 'svelte';
	import { toast } from 'svelte-sonner';
	import {
		PromptInput,
		PromptInputAction,
		PromptInputActions,
		PromptInputTextarea
	} from '$lib/components/prompt-kit/prompt-input';
	import { PromptSuggestion } from '$lib/components/prompt-kit/prompt-suggestion';
	import { FileUpload, FileUploadTrigger } from '$lib/components/prompt-kit/file-upload';
	import { Button } from '$lib/components/ui/button';
	import { ArrowUp, Camera, Paperclip } from '@lucide/svelte';
	import ChatAttachments from './ChatAttachments.svelte';
	import { getChatUIContext } from './ChatContext.svelte.js';
	import { ALLOWED_FILE_EXTENSIONS, MAX_FILE_SIZE, MAX_FILE_SIZE_LABEL } from '../core/types.js';

	let {
		suggestions = [],
		placeholder = 'Type a message...',
		showCameraButton = false,
		showFileButton = true,
		showHandoffButton = false,
		isHandedOff = false,
		onScreenshot,
		onSend,
		onRequestHandoff,
		actionsLeft,
		actionsRight,
		class: className = ''
	}: {
		/** Suggestion chips to show when empty */
		suggestions?: Array<{ text: string; label: string }>;
		/** Input placeholder text */
		placeholder?: string;
		/** Whether to show camera/screenshot button */
		showCameraButton?: boolean;
		/** Whether to show file upload button */
		showFileButton?: boolean;
		/** Whether to show the handoff to human button */
		showHandoffButton?: boolean;
		/** Whether thread is already handed off to humans */
		isHandedOff?: boolean;
		/** Callback when screenshot button clicked */
		onScreenshot?: () => void;
		/** Callback when message is sent - receives the prompt text */
		onSend?: (prompt: string) => Promise<void> | void;
		/** Callback when user requests handoff to human support */
		onRequestHandoff?: () => void;
		/** Custom left actions slot */
		actionsLeft?: Snippet;
		/** Custom right actions slot */
		actionsRight?: Snippet;
		/** Additional CSS classes */
		class?: string;
	} = $props();

	const ctx = getChatUIContext();

	// Use context for send validation
	const canSend = $derived(ctx.canSend && !ctx.core.isSending);

	async function handleSend() {
		if (!canSend) return;
		const prompt = ctx.inputValue.trim();
		ctx.clearInput();
		const sendPromise = onSend?.(prompt);
		ctx.clearAttachments();
		await sendPromise;
	}

	function handleValueChange(value: string) {
		ctx.setInputValue(value);
	}

	function handleCameraClick() {
		onScreenshot?.();
	}

	async function handleFilesAdded(files: File[]) {
		// Upload files through context (with duplicate detection and size validation)
		for (const file of files) {
			// Check file size
			if (file.size > MAX_FILE_SIZE) {
				toast.error(`File too large: "${file.name}"`, {
					description: `Maximum size is ${MAX_FILE_SIZE_LABEL}`
				});
				continue;
			}
			if (!ctx.hasFile(file.name, file.size)) {
				// Fire and forget - context manages progress
				ctx.uploadFile(file);
			}
		}
	}

	function handleRemoveAttachment(index: number) {
		ctx.removeAttachment(index);
	}

	function handleSuggestionClick(text: string) {
		ctx.setInputValue(text);
	}
</script>

<PromptInput
	class="relative z-20 {className}"
	value={ctx.inputValue}
	isLoading={ctx.core.isSending}
	onValueChange={handleValueChange}
	onSubmit={handleSend}
>
	<!-- Suggestion chips - shown when composing new message (no thread created yet) -->
	<!-- {#key} forces re-render on threadId change, triggering animation on navigation -->
	{#key ctx.core.threadId}
		{#if ctx.core.threadId === null && ctx.displayMessages.length === 0 && !ctx.inputValue.trim() && suggestions.length > 0}
			<div class="absolute top-0 z-20 translate-y-[-100%] animate-in pb-2 duration-200 fade-in-0">
				<div class="flex flex-wrap gap-2">
					{#each suggestions as suggestion}
						<PromptSuggestion onclick={() => handleSuggestionClick(suggestion.text)}>
							{suggestion.label}
						</PromptSuggestion>
					{/each}
				</div>
			</div>
		{/if}
	{/key}

	<!-- Handoff to human button - shown after first AI response, when not already handed off -->
	{#key `${ctx.core.threadId}-${isHandedOff}`}
		{#if showHandoffButton && ctx.core.threadId !== null && ctx.displayMessages.length > 1 && !isHandedOff && !ctx.inputValue.trim()}
			<div
				class="absolute top-0 z-20 translate-y-[-100%] animate-in pb-2 pl-5 duration-200 fade-in-0"
			>
				<div class="flex flex-wrap gap-2">
					<PromptSuggestion onclick={() => onRequestHandoff?.()}>Talk to a human</PromptSuggestion>
				</div>
			</div>
		{/if}
	{/key}

	<div class="flex flex-col p-2">
		{#if ctx.attachments.length > 0}
			<ChatAttachments
				class="mx-2 mt-2"
				attachments={ctx.attachments}
				onRemove={handleRemoveAttachment}
				columns={2}
			/>
		{/if}

		<PromptInputTextarea {placeholder} class="min-h-[44px] pt-3 pl-4 text-base leading-[1.3]" />

		<PromptInputActions class="mt-5 flex w-full items-center justify-between gap-2 px-3 pb-3">
			<div class="flex items-center gap-2">
				{#if actionsLeft}
					{@render actionsLeft()}
				{:else}
					{#if showCameraButton}
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
					{/if}
					{#if showFileButton}
						<FileUpload
							onFilesAdded={handleFilesAdded}
							multiple={true}
							accept={ALLOWED_FILE_EXTENSIONS}
						>
							<PromptInputAction>
								{#snippet tooltip()}
									<p>Attach files</p>
								{/snippet}
								<FileUploadTrigger asChild={true}>
									<Button variant="outline" size="icon" class="size-9 rounded-full">
										<Paperclip class="h-[18px] w-[18px]" />
									</Button>
								</FileUploadTrigger>
							</PromptInputAction>
						</FileUpload>
					{/if}
				{/if}
			</div>

			{#if actionsRight}
				{@render actionsRight()}
			{:else}
				<Button
					size="icon"
					disabled={!canSend}
					onclick={handleSend}
					class="size-9 rounded-full"
					aria-label="Send"
				>
					{#if !ctx.core.isSending}
						<ArrowUp class="h-[18px] w-[18px]" />
					{:else}
						<span class="size-3 rounded-xs bg-white"></span>
					{/if}
				</Button>
			{/if}
		</PromptInputActions>
	</div>
</PromptInput>
