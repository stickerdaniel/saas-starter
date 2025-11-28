<script lang="ts">
	import type { Snippet } from 'svelte';
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
	import Attachments from '$lib/components/customer-support/attachments.svelte';
	import { getChatUIContext } from './ChatContext.svelte.js';
	import type { Attachment } from '../core/types.js';

	let {
		attachments = [],
		suggestions = [],
		placeholder = 'Type a message...',
		showCameraButton = false,
		showFileButton = true,
		onScreenshot,
		onFilesAdded,
		onRemoveAttachment,
		onSend,
		actionsLeft,
		actionsRight,
		class: className = ''
	}: {
		/** Current attachments */
		attachments?: Attachment[];
		/** Suggestion chips to show when empty */
		suggestions?: Array<{ text: string; label: string }>;
		/** Input placeholder text */
		placeholder?: string;
		/** Whether to show camera/screenshot button */
		showCameraButton?: boolean;
		/** Whether to show file upload button */
		showFileButton?: boolean;
		/** Callback when screenshot button clicked */
		onScreenshot?: () => void;
		/** Callback when files are added */
		onFilesAdded?: (files: File[]) => void;
		/** Callback when attachment is removed */
		onRemoveAttachment?: (index: number) => void;
		/** Callback when message is sent */
		onSend?: () => void;
		/** Custom left actions slot */
		actionsLeft?: Snippet;
		/** Custom right actions slot */
		actionsRight?: Snippet;
		/** Additional CSS classes */
		class?: string;
	} = $props();

	const ctx = getChatUIContext();

	// Check if any uploads are pending or failed
	const hasUploadingFiles = $derived.by(() => {
		return attachments.some(
			(a) => (a.type === 'file' || a.type === 'screenshot') && a.uploadState?.status === 'uploading'
		);
	});

	const hasFailedUploads = $derived.by(() => {
		return attachments.some(
			(a) => (a.type === 'file' || a.type === 'screenshot') && a.uploadState?.status === 'error'
		);
	});

	// Disable send button if uploads pending or failed
	const canSend = $derived(
		!hasUploadingFiles && !hasFailedUploads && !!ctx.inputValue.trim() && !ctx.core.isSending
	);

	async function handleSend() {
		if (!canSend) return;
		onSend?.();
	}

	function handleValueChange(value: string) {
		ctx.setInputValue(value);
	}

	function handleCameraClick() {
		onScreenshot?.();
	}

	function handleFilesAdded(files: File[]) {
		onFilesAdded?.(files);
	}

	function handleRemoveAttachment(index: number) {
		onRemoveAttachment?.(index);
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
	<!-- Suggestion chips - shown when chat is empty -->
	{#if ctx.displayMessages.length === 0 && !ctx.inputValue.trim() && suggestions.length > 0}
		<div class="absolute top-0 z-20 translate-y-[-100%] pb-2">
			<div class="flex flex-wrap gap-2">
				{#each suggestions as suggestion}
					<PromptSuggestion onclick={() => handleSuggestionClick(suggestion.text)}>
						{suggestion.label}
					</PromptSuggestion>
				{/each}
			</div>
		</div>
	{/if}

	<div class="flex flex-col p-2">
		{#if attachments.length > 0}
			<Attachments class="mx-2 mt-2" {attachments} onRemove={handleRemoveAttachment} columns={2} />
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
						<FileUpload onFilesAdded={handleFilesAdded} multiple={true}>
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
