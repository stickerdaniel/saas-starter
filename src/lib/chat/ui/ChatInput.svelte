<script lang="ts">
	import { tick, type Snippet } from 'svelte';
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
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import ChatAttachments from './ChatAttachments.svelte';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import { getChatUIContext } from './ChatContext.svelte.js';
	import { processImage } from '$lib/media/process-image';
	import {
		ALLOWED_FILE_EXT_MIME,
		ALLOWED_FILE_EXTENSIONS,
		ALLOWED_FILE_TYPES,
		MAX_ATTACHMENTS,
		MAX_FILE_SIZE,
		MAX_FILE_SIZE_LABEL,
		MAX_INPUT_IMAGE_SIZE,
		MAX_INPUT_IMAGE_SIZE_LABEL
	} from '../core/types.js';

	const { t } = getTranslate();

	let {
		suggestions = [],
		placeholder = 'Type a message...',
		placeholderNoSuggestions,
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
		/** Placeholder text when suggestions are not visible */
		placeholderNoSuggestions?: string;
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

	let containerEl: HTMLDivElement;

	// Use centralized isProcessing from context (single source of truth)
	// When handed off to human support, don't block - use fire-and-forget pattern
	const canSend = $derived(ctx.canSend && (!ctx.isProcessing || isHandedOff) && !isRateLimited);

	const showSuggestions = $derived(
		(ctx.core.isNewConversation || ctx.messagesReady) &&
			ctx.displayMessages.length === 0 &&
			!ctx.inputValue.trim() &&
			suggestions.length > 0
	);

	const activePlaceholder = $derived(
		showSuggestions ? placeholder : (placeholderNoSuggestions ?? placeholder)
	);

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
		haptic.trigger('medium');
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

	/**
	 * Browser-supplied MIMEs that don't tell us anything specific. For these
	 * we fall back to the file extension. Any *non*-generic MIME is trusted
	 * as-is — a file with type `image/heic` named `photo.jpg` must be
	 * rejected, not silently accepted via the .jpg fallback.
	 */
	const GENERIC_MIMES = new Set(['', 'application/octet-stream']);

	function getExt(name: string): string | null {
		const dot = name.lastIndexOf('.');
		return dot >= 0 ? name.slice(dot).toLowerCase() : null;
	}

	function isAllowedKind(file: File): boolean {
		if (GENERIC_MIMES.has(file.type)) {
			const ext = getExt(file.name);
			return ext != null && ext in ALLOWED_FILE_EXT_MIME;
		}
		return ALLOWED_FILE_TYPES.includes(file.type);
	}

	/**
	 * When the browser left `File.type` empty or generic, infer it from the
	 * extension before handing the file to the rest of the pipeline. This is
	 * the difference between an HEIC drag landing as `image/heic` (rejected)
	 * vs. a legitimate Finder-dragged `.png` landing as `''` (skipped from
	 * processImage and uploaded as `application/octet-stream`, then rejected
	 * server-side). Same generic-only rule as `isAllowedKind` so the two
	 * helpers stay consistent.
	 */
	function normalizeMime(file: File): File {
		if (!GENERIC_MIMES.has(file.type)) return file;
		const ext = getExt(file.name);
		const mime = ext ? ALLOWED_FILE_EXT_MIME[ext] : undefined;
		if (!mime) return file;
		return new File([file], file.name, { type: mime, lastModified: file.lastModified });
	}

	/**
	 * Route image-typed files through processImage (resize + WebP encode on a
	 * worker) before handing them to the upload context. The preprocess
	 * callback runs INSIDE ctx.uploadFile, after the placeholder attachment
	 * is inserted, so canSend / hasFile / MAX_ATTACHMENTS guards see the
	 * in-progress attachment during the encode window.
	 */
	function attachFile(file: File | Blob, filename: string) {
		if (file.type?.startsWith('image/')) {
			ctx.uploadFile(file, filename, {
				preprocess: async (input) => {
					const processed = await processImage(input);
					// Post-process size guard. WebP at q=85 is almost always smaller
					// than the source for screenshots and large photos, but pathological
					// inputs (already heavily compressed JPEGs, small high-detail tiles)
					// can re-encode larger. The server enforces MAX_FILE_SIZE on the
					// stored blob, so:
					//   - if both the encoded output AND the original exceed
					//     MAX_FILE_SIZE, throw — server would reject either, and
					//     the input cap allows up to MAX_INPUT_IMAGE_SIZE so the
					//     original may be too big.
					//   - otherwise fall back to the smaller-than-cap original,
					//     since the server will accept it as-is.
					if (processed.blob.size > MAX_FILE_SIZE) {
						if (input.size > MAX_FILE_SIZE) {
							throw new Error(
								$t('chat.error.image_compression_exceeded', {
									maxSize: MAX_FILE_SIZE_LABEL
								})
							);
						}
						return {
							blob: input,
							mimeType: input.type,
							filename
							// Skip width/height; ctx.uploadFile will read them off the
							// original blob.
						};
					}
					return {
						blob: processed.blob,
						mimeType: processed.mimeType,
						// Derive the upload filename from the actual mime type rather
						// than the passthrough flag; the main-thread fallback also
						// transforms to WebP, and we never want WebP bytes under a
						// .png/.jpg name.
						filename:
							processed.mimeType === 'image/webp'
								? filename.replace(/\.[^.]+$/, '') + '.webp'
								: filename,
						width: processed.width,
						height: processed.height
					};
				}
			});
			return;
		}
		ctx.uploadFile(file, filename);
	}

	async function handleFilesAdded(files: File[]) {
		// Upload files through context (with duplicate detection and size validation)
		for (const raw of files) {
			// Check attachment limit
			if (ctx.attachments.length >= MAX_ATTACHMENTS) {
				haptic.trigger('error');
				toast.error($t('chat.error.max_attachments', { max: MAX_ATTACHMENTS }));
				break;
			}

			// MIME allowlist gate (drag/drop bypasses the file picker's
			// `accept` filter, so HEIC/TIFF/etc. would otherwise slip through
			// to processImage and waste an upload before the server rejects).
			if (!isAllowedKind(raw)) {
				haptic.trigger('error');
				toast.error($t('chat.error.file_type_not_allowed', { filename: raw.name }));
				continue;
			}

			// Normalise BEFORE size/branch checks so attachFile sees a real
			// MIME type and routes images through processImage.
			const file = normalizeMime(raw);

			const isImage = file.type.startsWith('image/');
			const cap = isImage ? MAX_INPUT_IMAGE_SIZE : MAX_FILE_SIZE;
			const label = isImage ? MAX_INPUT_IMAGE_SIZE_LABEL : MAX_FILE_SIZE_LABEL;

			if (file.size > cap) {
				haptic.trigger('error');
				toast.error($t('chat.error.file_too_large', { filename: file.name }), {
					description: $t('chat.error.file_max_size', { maxSize: label })
				});
				continue;
			}

			if (!ctx.hasFile(file.name, file.size)) {
				haptic.trigger('medium');
				// Fire and forget - context manages progress
				attachFile(file, file.name);
			}
		}
	}

	function handleRemoveAttachment(index: number) {
		ctx.removeAttachment(index);
	}

	function handleSuggestionClick(text: string) {
		ctx.setInputValue(text);
		tick().then(() => {
			containerEl?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
		});
	}

	function handlePaste(event: ClipboardEvent) {
		const items = event.clipboardData?.items;
		if (!items) return;

		for (const item of items) {
			// Only file items become attachments; string items (e.g. pasted
			// text, which now matches text/plain in the allowlist) fall through
			// to the textarea's default paste handling.
			if (item.kind !== 'file') continue;

			const raw = item.getAsFile();
			if (!raw) continue;

			// Extension-aware allowlist gate: a pasted file's clipboard type is
			// often empty/generic (notably .md/.txt), so check the extension
			// fallback like handleFilesAdded rather than the bare item.type.
			if (!isAllowedKind(raw)) continue;

			// Check attachment limit
			if (ctx.attachments.length >= MAX_ATTACHMENTS) {
				haptic.trigger('error');
				toast.error($t('chat.error.max_attachments', { max: MAX_ATTACHMENTS }));
				break;
			}

			// Coerce empty/generic MIME from the extension before branching, so
			// attachFile routes images through processImage and the upload sends
			// the correct Content-Type for text files.
			const file = normalizeMime(raw);

			// Type-aware size cap — images go through processImage which
			// shrinks them before upload, so we only enforce the absurdity
			// ceiling on the input. Non-image files upload as-is, so the
			// 5 MB server cap applies to the input directly.
			const isImage = file.type.startsWith('image/');
			const cap = isImage ? MAX_INPUT_IMAGE_SIZE : MAX_FILE_SIZE;
			const label = isImage ? MAX_INPUT_IMAGE_SIZE_LABEL : MAX_FILE_SIZE_LABEL;

			if (file.size > cap) {
				toast.error($t('chat.error.pasted_file_too_large'), {
					description: $t('chat.error.file_max_size', { maxSize: label })
				});
				continue;
			}

			// Use original filename if available, otherwise generate one
			const filename =
				file.name ||
				`pasted-${file.type.startsWith('image/') ? 'image' : 'file'}-${Date.now()}.${file.type.split('/')[1] || 'bin'}`;

			// Check for duplicates (unlikely for pasted files, but consistent with file upload)
			if (!ctx.hasFile(filename, file.size)) {
				attachFile(file, filename);
			}
		}
	}
</script>

<div bind:this={containerEl} class={className}>
	<!-- Suggestion chips - shown when starting new conversation or after messages loaded and empty -->
	<!-- isNewConversation: show immediately for draft threads (eager creation) -->
	<!-- messagesReady: wait for query to resolve for existing threads (prevents flash) -->
	{#if showSuggestions}
		<div class="pb-2">
			{#key ctx.core.threadGeneration}
				<div class="flex flex-wrap gap-2">
					{#each suggestions as suggestion, i (suggestion.text)}
						<div
							class="max-w-full min-w-0 motion-safe:animate-[chip-in_375ms_ease-out_both] sm:max-w-[14rem]"
							style="animation-delay: {i * 50}ms"
						>
							<PromptSuggestion
								class="w-full"
								truncate
								title={suggestion.text}
								onclick={() => handleSuggestionClick(suggestion.text)}
							>
								{suggestion.label}
							</PromptSuggestion>
						</div>
					{/each}
				</div>
			{/key}
		</div>
	{/if}
	<PromptInput
		class="relative z-20 bg-popover p-0"
		value={ctx.inputValue}
		isLoading={ctx.core.isSending}
		onValueChange={handleValueChange}
		onSubmit={handleSend}
	>
		<div class="flex flex-col">
			{#if ctx.attachments.length > 0}
				<ChatAttachments
					class="mx-3 mt-3"
					attachments={ctx.attachments}
					onRemove={handleRemoveAttachment}
					columns={2}
				/>
			{/if}

			<PromptInputTextarea
				placeholder={activePlaceholder}
				class="min-h-[44px] pt-3 pl-4 text-base leading-[1.3]"
				onpaste={handlePaste}
				maxlength={2000}
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
							class="size-9 shrink-0 rounded-full"
							aria-label={$t('chat.aria.send')}
						>
							{#if ctx.isProcessing && !isHandedOff}
								<LoaderCircleIcon class="h-[18px] w-[18px] motion-safe:animate-spin" />
							{:else}
								<ArrowUpIcon class="h-[18px] w-[18px]" />
							{/if}
						</Button>
					</div>
				{/if}
			</PromptInputActions>
		</div>
	</PromptInput>
</div>
