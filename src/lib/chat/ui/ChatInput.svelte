<script lang="ts">
	import { onDestroy, tick, type Snippet } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
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
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import ImageIcon from '@lucide/svelte/icons/image';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ChatAttachments from './ChatAttachments.svelte';
	import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
	import { getChatUIContext } from './chat-context.svelte.ts';
	import { processImage } from '$lib/media/process-image';
	import {
		ALLOWED_FILE_EXT_MIME,
		ALLOWED_FILE_EXTENSIONS,
		ALLOWED_FILE_TYPES,
		MAX_ATTACHMENTS,
		MAX_FILE_SIZE,
		MAX_FILE_SIZE_LABEL,
		MAX_INPUT_IMAGE_SIZE,
		MAX_INPUT_IMAGE_SIZE_LABEL,
		MAX_MESSAGE_LENGTH
	} from '../core/types.js';

	const { t } = getTranslate();

	let {
		suggestions = [],
		placeholder = 'Type a message...',
		placeholderNoSuggestions,
		placeholders = [],
		inputLabel,
		showCameraButton = false,
		showFileButton = true,
		showHandoffButton = false,
		compact = false,
		isHumanOnly = false,
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
		/** Placeholder copy to rotate through in compact mode */
		placeholders?: string[];
		/** Accessible input name when it differs from the visible placeholder */
		inputLabel?: string;
		/** Whether to show camera/screenshot button */
		showCameraButton?: boolean;
		/** Whether to show file upload button */
		showFileButton?: boolean;
		/** Whether to show the handoff to human button */
		showHandoffButton?: boolean;
		/** Whether to use the compact single-row composer */
		compact?: boolean;
		/**
		 * Whether a human answers this thread, so nothing is waiting on a model.
		 * True both for a thread handed off to the team and for one that never had
		 * an agent in front of it. Do not read it as "handed off": a support build
		 * with the agent switched off sets it on threads the team has not seen.
		 */
		isHumanOnly?: boolean;
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

	let containerEl = $state<HTMLDivElement>();
	let fileInputEl = $state<HTMLInputElement>();
	let placeholderIndex = $state(0);
	let placeholderTimer: ReturnType<typeof setInterval> | undefined;
	const focusComposer = () => containerEl?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
	ctx.registerComposerFocus(focusComposer);

	// Use centralized isProcessing from context (single source of truth)
	// When handed off to human support, don't block - use fire-and-forget pattern
	const canSend = $derived(ctx.canSend && (!ctx.isProcessing || isHumanOnly) && !isRateLimited);

	const showSuggestions = $derived(
		(ctx.core.isNewConversation || ctx.messagesReady) &&
			ctx.displayMessages.length === 0 &&
			!ctx.inputValue.trim() &&
			suggestions.length > 0
	);

	const activePlaceholder = $derived(
		showSuggestions ? placeholder : (placeholderNoSuggestions ?? placeholder)
	);
	// Compact mode rotates through the caller's suggestion copy as vanishing hints.
	const rotatingPlaceholders = $derived(compact ? placeholders : []);
	// Content-based key so the index only resets when the copy actually changes
	// (locale or thread switch), not on every re-derivation of the same list.
	const placeholderKey = $derived(rotatingPlaceholders.join('\u0001'));
	const visiblePlaceholder = $derived(
		rotatingPlaceholders.length > 0
			? rotatingPlaceholders[placeholderIndex % rotatingPlaceholders.length]
			: activePlaceholder
	);
	// A stable accessible name for the compact field; the rotating hint is decorative.
	const composerLabel = $derived(inputLabel ?? placeholderNoSuggestions ?? placeholder);
	// Pause rotation while typing, under reduced motion, or with fewer than two hints.
	const canRotate = $derived(
		compact && rotatingPlaceholders.length >= 2 && !ctx.inputValue && !prefersReducedMotion.current
	);

	function stopPlaceholderRotation() {
		if (placeholderTimer !== undefined) {
			clearInterval(placeholderTimer);
			placeholderTimer = undefined;
		}
	}

	function startPlaceholderRotation() {
		stopPlaceholderRotation();
		if (document.visibilityState !== 'visible') return;
		placeholderTimer = setInterval(() => {
			placeholderIndex = (placeholderIndex + 1) % rotatingPlaceholders.length;
		}, 3000);
	}

	function handleVisibilityChange() {
		if (document.visibilityState === 'visible' && canRotate) startPlaceholderRotation();
		else stopPlaceholderRotation();
	}

	$effect(() => {
		if (!canRotate) {
			stopPlaceholderRotation();
			return;
		}
		startPlaceholderRotation();
		return stopPlaceholderRotation;
	});

	// Restart from the first hint whenever the rotation copy changes.
	$effect(() => {
		void placeholderKey;
		placeholderIndex = 0;
	});

	$effect(() => {
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
	});

	onDestroy(() => {
		stopPlaceholderRotation();
		ctx.unregisterComposerFocus(focusComposer);
	});

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
		const prevAttachments = [...ctx.attachments];
		ctx.clearInput();
		try {
			// Invoke onSend before clearAttachments so consumers can still read
			// ctx.attachments synchronously in their onSend prefix.
			const sendPromise = onSend?.(prompt);
			ctx.clearAttachments();
			await sendPromise;
		} catch (error) {
			console.error('[ChatInput] onSend failed:', error);
			// Rollback so a failed send does not silently eat the message.
			// Consumers that handle errors themselves (toasts, rate limits)
			// rethrow so this restore still runs. Skip restore if the user
			// already typed or attached something new in the meantime.
			if (!ctx.inputValue.trim()) ctx.setInputValue(prompt);
			if (ctx.attachments.length === 0) {
				// clearAttachments revoked blob: previews; strip them so the
				// thumbnail falls back to the uploaded url, not a dead blob.
				ctx.addAttachments(
					prevAttachments.map((a) =>
						'preview' in a && a.preview?.startsWith('blob:') ? { ...a, preview: undefined } : a
					)
				);
			}
		}
	}

	function handleValueChange(value: string) {
		ctx.setInputValue(value);
	}

	function handleCameraClick() {
		onScreenshot?.();
	}

	function openFilePicker() {
		fileInputEl?.click();
	}

	function handleFileInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		void handleFilesAdded(Array.from(input.files ?? []));
		input.value = '';
	}

	// Compact layout switches ChatGPT-style once the text wraps: the pill
	// (rounded-full, inline actions) becomes a rounded box with the action row
	// below the textarea. Wrapping is detected from the textarea's scrollHeight
	// vs its single-line height, re-measured on every input/layout change.
	let compactWrapper: HTMLDivElement | undefined = $state();
	let compactMultiline = $state(false);
	// True once the textarea content exceeds its max height and starts to
	// scroll internally; the overflowing text then fades into the composer
	// background at both edges instead of clipping hard.
	let compactScrollable = $state(false);
	// Wrap detection must not read the textarea's live geometry: switching the
	// layout changes the field's width (inline actions vs full row), so the same
	// text can wrap in the pill but fit expanded — geometry-based checks
	// oscillate at that boundary. Instead the text is measured with canvas
	// measureText against the width the field has IN THE PILL layout; that
	// reference width is layout-independent, so the decision is stable.
	let measureCanvas: CanvasRenderingContext2D | null = null;
	function textNeedsWrap(textarea: HTMLTextAreaElement, pillWidth: number): boolean {
		const value = textarea.value;
		if (!value) return false;
		if (value.includes('\n')) return true;
		measureCanvas ??= document.createElement('canvas').getContext('2d');
		if (!measureCanvas) return textarea.scrollHeight > 44;
		const s = getComputedStyle(textarea);
		measureCanvas.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
		return measureCanvas.measureText(value).width > pillWidth;
	}

	// The pill-layout text width: wrapper minus both inline action bars and the
	// horizontal paddings. Captured while in the pill; kept as the reference
	// while expanded so the decision does not depend on the current layout.
	let pillTextWidth = 0;

	$effect(() => {
		if (!compact || !compactWrapper || typeof ResizeObserver === 'undefined') return;
		const wrapper = compactWrapper;
		const measure = () => {
			const textarea = wrapper.querySelector<HTMLTextAreaElement>('textarea');
			if (!textarea) return;
			if (!compactMultiline) {
				// Only re-capture the reference width while the pill is showing.
				pillTextWidth = textarea.clientWidth - 10;
			}
			compactMultiline = pillTextWidth > 0 && textNeedsWrap(textarea, pillTextWidth);
			compactScrollable = textarea.scrollHeight > textarea.clientHeight + 1;
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(wrapper);
		return () => observer.disconnect();
	});

	// Re-measure after every value change once the DOM settled — covers typing,
	// paste, draft restore, and ?prompt= prefill alike.
	$effect(() => {
		if (!compact) return;
		void ctx.inputValue;
		tick().then(() => {
			const textarea = compactWrapper?.querySelector<HTMLTextAreaElement>('textarea');
			if (!textarea) return;
			if (!compactMultiline) pillTextWidth = textarea.clientWidth - 10;
			compactMultiline = pillTextWidth > 0 && textNeedsWrap(textarea, pillTextWidth);
			compactScrollable = textarea.scrollHeight > textarea.clientHeight + 1;
		});
	});

	// Window-level drag/drop for the compact composer. The non-compact path gets
	// this from <FileUpload>; the compact path handles it here so a dropped file
	// attaches (and, critically, so the browser doesn't navigate away to open it).
	let dragActive = $state(false);
	let dragDepth = 0;
	const dropEnabled = $derived(compact && showFileButton && !isRateLimited);

	function handleWindowDragEnter(event: DragEvent) {
		if (!dropEnabled) return;
		event.preventDefault();
		dragDepth += 1;
		if (event.dataTransfer?.types.includes('Files')) dragActive = true;
	}

	function handleWindowDragOver(event: DragEvent) {
		if (!dropEnabled) return;
		event.preventDefault();
	}

	function handleWindowDragLeave(event: DragEvent) {
		if (!dropEnabled) return;
		event.preventDefault();
		dragDepth -= 1;
		if (dragDepth <= 0) {
			dragDepth = 0;
			dragActive = false;
		}
	}

	function handleWindowDrop(event: DragEvent) {
		if (!dropEnabled) return;
		event.preventDefault();
		dragDepth = 0;
		dragActive = false;
		const files = event.dataTransfer?.files;
		if (files?.length) void handleFilesAdded(Array.from(files));
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

	function handleRetryAttachment(index: number) {
		ctx.retryUpload(index);
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

<svelte:window
	ondragenter={handleWindowDragEnter}
	ondragover={handleWindowDragOver}
	ondragleave={handleWindowDragLeave}
	ondrop={handleWindowDrop}
/>

{#snippet leftActions()}
	<div class="flex items-center gap-2">
		{#if actionsLeft}
			{@render actionsLeft()}
		{:else if compact && (showFileButton || showCameraButton)}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon"
							class="size-9 rounded-full"
							aria-label={$t('chat.tooltip.more_actions')}
						>
							<PlusIcon class="size-[18px]" aria-hidden="true" />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" side="top" class="w-48">
					{#if showFileButton}
						<DropdownMenu.Item onclick={openFilePicker}>
							<PaperclipIcon class="size-4" aria-hidden="true" />
							{$t('chat.tooltip.attach_files')}
						</DropdownMenu.Item>
					{/if}
					{#if showCameraButton}
						<DropdownMenu.Item onclick={handleCameraClick}>
							<ImageIcon class="size-4" aria-hidden="true" />
							{$t('chat.tooltip.mark_bug')}
						</DropdownMenu.Item>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			{#if showFileButton}
				<!-- Triggered only via the menu / drop; `hidden` keeps it out of the tab
				     order and the a11y tree. -->
				<input
					bind:this={fileInputEl}
					type="file"
					multiple
					accept={ALLOWED_FILE_EXTENSIONS}
					hidden
					aria-hidden="true"
					tabindex="-1"
					onchange={handleFileInput}
				/>
			{/if}
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
							class={compact
								? 'size-9 rounded-full border-0 bg-transparent shadow-none'
								: 'size-9 rounded-full'}
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
									class={compact
										? 'size-9 rounded-full border-0 bg-transparent shadow-none'
										: 'size-9 rounded-full'}
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
{/snippet}

{#snippet rightActions()}
	{#if actionsRight}
		{@render actionsRight()}
	{:else}
		<div class="flex min-w-0 items-center gap-2">
			{#if showHandoffButton}
				{@const isVisible =
					ctx.core.threadId !== null &&
					ctx.displayMessages.length > 1 &&
					!isHumanOnly &&
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
				data-testid="chat-input-send"
			>
				{#if ctx.isProcessing && !isHumanOnly}
					<LoaderCircleIcon class="h-[18px] w-[18px] motion-safe:animate-spin" />
				{:else}
					<ArrowUpIcon class="h-[18px] w-[18px]" />
				{/if}
			</Button>
		</div>
	{/if}
{/snippet}

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
	<!-- Fixed 25px radius: the one-line pill is 48px tall (36px field + 12px
	     padding) plus its border, so 25px is fully round there and simply stays
	     put when the field grows — no radius jump between layouts. -->
	<PromptInput
		class={compact
			? `composer-elevation relative z-20 rounded-[25px] border-0 bg-popover ${compactMultiline ? 'p-0' : 'p-1.5'}`
			: 'relative z-20 bg-popover p-0'}
		value={ctx.inputValue}
		isLoading={ctx.core.isSending}
		onValueChange={handleValueChange}
		onSubmit={handleSend}
	>
		{#if compact}
			<div class="relative flex min-w-0 flex-col" bind:this={compactWrapper}>
				{#if dragActive}
					<div
						class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center gap-2 rounded-[25px] bg-popover/90 text-sm font-medium text-muted-foreground backdrop-blur-sm"
						aria-hidden="true"
					>
						<PaperclipIcon class="size-4" />
						{$t('chat.tooltip.attach_files')}
					</div>
				{/if}
				{#if ctx.attachments.length > 0}
					<ChatAttachments
						class="mx-1 mb-1"
						attachments={ctx.attachments}
						onRemove={handleRemoveAttachment}
						onRetry={handleRetryAttachment}
						columns={2}
					/>
				{/if}
				<!-- Single line: actions inline beside the textarea (pill). Multi-line:
				     the textarea spans the full width and the actions drop to a row
				     below (ChatGPT-style). Only the action bars move between branches;
				     the textarea itself never remounts, so focus and caret survive the
				     layout switch mid-typing. -->
				<div class="flex min-w-0 items-end gap-1">
					{#if !compactMultiline}
						<PromptInputActions class="shrink-0">
							{@render leftActions()}
						</PromptInputActions>
					{/if}
					<!-- Expanded: inset the textarea's right edge so its scrollbar sits
					     where the corner rounding stops instead of colliding with it. -->
					<div class="relative min-w-0 flex-1 {compactMultiline ? 'pr-1.5' : ''}">
						<PromptInputTextarea
							placeholder=""
							aria-label={composerLabel}
							class="min-h-9 py-2 text-base leading-5 {compactMultiline
								? 'pr-2 pl-3'
								: 'px-1'} {compactScrollable
								? '[mask-image:linear-gradient(to_bottom,transparent_0,black_20px,black_calc(100%-20px),transparent_100%)]'
								: ''}"
							onpaste={handlePaste}
							maxlength={MAX_MESSAGE_LENGTH}
							data-testid="chat-input-textarea"
						/>
						{#if !ctx.inputValue}
							<!-- Decorative rotating hint; the textarea carries the accessible name. -->
							<div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
								{#key visiblePlaceholder}
									<span
										class="absolute inset-0 flex items-center truncate px-1 text-base leading-5 text-muted-foreground md:text-sm"
										in:fly={{
											y: prefersReducedMotion.current ? 0 : 8,
											duration: prefersReducedMotion.current ? 0 : 180
										}}
										out:fly={{
											y: prefersReducedMotion.current ? 0 : -8,
											duration: prefersReducedMotion.current ? 0 : 140
										}}
									>
										{visiblePlaceholder}
									</span>
								{/key}
							</div>
						{/if}
					</div>
					{#if !compactMultiline}
						<PromptInputActions class="min-w-0 shrink-0">
							{@render rightActions()}
						</PromptInputActions>
					{/if}
				</div>
				{#if compactMultiline}
					<PromptInputActions class="flex w-full items-center justify-between gap-1 px-1.5 pb-1.5">
						{@render leftActions()}
						<div class="flex min-w-0 items-center gap-1">
							{@render rightActions()}
						</div>
					</PromptInputActions>
				{/if}
			</div>
		{:else}
			<div class="flex flex-col">
				{#if ctx.attachments.length > 0}
					<ChatAttachments
						class="mx-3 mt-3"
						attachments={ctx.attachments}
						onRemove={handleRemoveAttachment}
						onRetry={handleRetryAttachment}
						columns={2}
					/>
				{/if}
				<PromptInputTextarea
					placeholder={activePlaceholder}
					class="min-h-[44px] pt-3 pl-4 text-base leading-[1.3]"
					onpaste={handlePaste}
					maxlength={MAX_MESSAGE_LENGTH}
					data-testid="chat-input-textarea"
				/>
				<PromptInputActions class="mt-5 flex w-full items-center justify-between gap-2 px-3 pb-3">
					{@render leftActions()}
					{@render rightActions()}
				</PromptInputActions>
			</div>
		{/if}
	</PromptInput>
</div>
