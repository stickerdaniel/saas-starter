<script lang="ts">
	import type { Snippet } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { getTranslate } from '@tolgee/svelte';
	import {
		PromptInput,
		PromptInputAction,
		PromptInputActions,
		PromptInputTextarea
	} from '$lib/components/prompt-kit/prompt-input';
	import { PromptSuggestion } from '$lib/components/prompt-kit/prompt-suggestion';
	import { FileUpload, FileUploadTrigger } from '$lib/components/prompt-kit/file-upload';
	import { Button } from '$lib/components/ui/button';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import ChatAttachments from './ChatAttachments.svelte';
	import { getChatUIContext } from './ChatContext.svelte.js';
	import {
		ALLOWED_FILE_EXTENSIONS,
		ALLOWED_FILE_TYPES,
		MAX_ATTACHMENTS,
		MAX_FILE_SIZE,
		MAX_FILE_SIZE_LABEL
	} from '../core/types.js';

	const { t } = getTranslate();

	let {
		suggestions = [],
		placeholder = 'Type a message...',
		showCameraButton = false,
		showFileButton = true,
		showHandoffButton = false,
		isHandedOff = false,
		isRateLimited = false,
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
		/** Whether user is rate limited from sending messages */
		isRateLimited?: boolean;
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

	// Use context for send validation - also check rate limit
	const canSend = $derived(ctx.canSend && !ctx.core.isSending && !isRateLimited);

	// Check if last assistant message is complete (for handoff button visibility)
	const lastAssistantComplete = $derived.by(() => {
		const last = ctx.displayMessages.findLast((m) => m.role === 'assistant');
		return last?.status === 'success' || last?.status === 'failed';
	});

	// Sticky state: once true, stays true for the session
	let hasShownHandoffButton = $state(false);

	// Update sticky state when conditions are first met
	$effect(() => {
		if (lastAssistantComplete && !hasShownHandoffButton) {
			hasShownHandoffButton = true;
		}
	});

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
			// Check attachment limit
			if (ctx.attachments.length >= MAX_ATTACHMENTS) {
				toast.error($t('chat.error.max_attachments', { max: MAX_ATTACHMENTS }));
				break;
			}
			// Check file size
			if (file.size > MAX_FILE_SIZE) {
				toast.error($t('chat.error.file_too_large', { filename: file.name }), {
					description: $t('chat.error.file_max_size', { maxSize: MAX_FILE_SIZE_LABEL })
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

	function handlePaste(event: ClipboardEvent) {
		const items = event.clipboardData?.items;
		if (!items) return;

		for (const item of items) {
			// Only process allowed file types
			if (!ALLOWED_FILE_TYPES.includes(item.type)) {
				continue;
			}

			// Check attachment limit
			if (ctx.attachments.length >= MAX_ATTACHMENTS) {
				toast.error($t('chat.error.max_attachments', { max: MAX_ATTACHMENTS }));
				break;
			}

			const file = item.getAsFile();
			if (!file) continue;

			// Validate file size
			if (file.size > MAX_FILE_SIZE) {
				toast.error($t('chat.error.pasted_file_too_large'), {
					description: $t('chat.error.file_max_size', { maxSize: MAX_FILE_SIZE_LABEL })
				});
				continue;
			}

			// Use original filename if available, otherwise generate one
			const filename =
				file.name ||
				`pasted-${file.type.startsWith('image/') ? 'image' : 'file'}-${Date.now()}.${file.type.split('/')[1] || 'bin'}`;

			// Check for duplicates (unlikely for pasted files, but consistent with file upload)
			if (!ctx.hasFile(filename, file.size)) {
				ctx.uploadFile(file, filename);
			}
		}
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

	<div class="flex flex-col p-2">
		{#if ctx.attachments.length > 0}
			<ChatAttachments
				class="mx-2 mt-2"
				attachments={ctx.attachments}
				onRemove={handleRemoveAttachment}
				columns={2}
			/>
		{/if}

		<PromptInputTextarea
			{placeholder}
			class="min-h-[44px] pt-3 pl-4 text-base leading-[1.3]"
			onpaste={handlePaste}
		/>

		<PromptInputActions class="mt-5 flex w-full items-center justify-between gap-2 px-3 pb-3">
			<div class="flex items-center gap-2">
				{#if actionsLeft}
					{@render actionsLeft()}
				{:else}
					{#if showCameraButton}
						<PromptInputAction>
							{#snippet tooltip()}
								<p>{$t('chat.tooltip.mark_bug')}</p>
							{/snippet}
							{#snippet children(props)}
								<Button
									{...props}
									variant="outline"
									size="icon"
									class="size-9 rounded-full"
									onclick={handleCameraClick}
									aria-label={$t('chat.tooltip.mark_bug')}
								>
									<CameraIcon class="h-[18px] w-[18px]" />
								</Button>
							{/snippet}
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
									<p>{$t('chat.tooltip.attach_files')}</p>
								{/snippet}
								{#snippet children(props)}
									<FileUploadTrigger asChild={true}>
										<Button
											{...props}
											variant="outline"
											size="icon"
											class="size-9 rounded-full"
											aria-label={$t('chat.tooltip.attach_files')}
										>
											<PaperclipIcon class="h-[18px] w-[18px]" />
										</Button>
									</FileUploadTrigger>
								{/snippet}
							</PromptInputAction>
						</FileUpload>
					{/if}
				{/if}
			</div>

			{#if actionsRight}
				{@render actionsRight()}
			{:else}
				<div class="flex min-w-0 items-center gap-2">
					{#if showHandoffButton}
						{@const isVisible =
							ctx.core.threadId !== null &&
							ctx.displayMessages.length > 1 &&
							!isHandedOff &&
							hasShownHandoffButton}
						<div
							class="min-w-0 transition-opacity duration-200 {isVisible
								? 'opacity-100'
								: 'pointer-events-none opacity-0'}"
							inert={!isVisible ? true : undefined}
						>
							<PromptSuggestion class="max-w-full" onclick={() => onRequestHandoff?.()}>
								<span class="block truncate">{$t('chat.action.talk_to_human')}</span>
							</PromptSuggestion>
						</div>
					{/if}
					<Button
						size="icon"
						disabled={!canSend}
						onclick={handleSend}
						class="size-9 flex-shrink-0 rounded-full"
						aria-label={$t('chat.aria.send')}
					>
						<ArrowUpIcon class="h-[18px] w-[18px]" />
					</Button>
				</div>
			{/if}
		</PromptInputActions>
	</div>
</PromptInput>
