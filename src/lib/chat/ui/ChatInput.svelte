<script lang="ts">
	import { onDestroy, tick, type Snippet } from 'svelte';
	import { on } from 'svelte/events';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';
	import { getTranslate } from '@tolgee/svelte';
	import {
		PromptInput,
		PromptInputAction,
		PromptInputActions,
		PromptInputTextarea
	} from '#lib/components/prompt-kit/prompt-input/index.js';
	import { PromptSuggestion } from '#lib/components/prompt-kit/prompt-suggestion/index.js';
	import { FileUpload, FileUploadTrigger } from '#lib/components/prompt-kit/file-upload/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import ComposerAttachmentButton from '#lib/components/ui/owned/composer-attachment-button.svelte';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import ImageIcon from '@lucide/svelte/icons/image';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ChatAttachments from './ChatAttachments.svelte';
	import { cn } from '#lib/utils.js';
	import { haptic } from '#lib/hooks/use-haptic.svelte.ts';
	import { getChatUIContext } from './chat-context.svelte.ts';
	import { processImage } from '#lib/media/process-image.js';
	import {
		MAX_INPUT_IMAGE_SIZE,
		MAX_INPUT_IMAGE_SIZE_LABEL,
		MAX_MESSAGE_LENGTH
	} from '../core/types.js';
	import {
		acceptAttribute,
		acceptsMimeType,
		imageUploadLimit,
		profileMimeType
	} from '../../uploads/profiles.js';
	import { AttachmentRefusal } from './attachment-transfer.js';

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
		disabled = false,
		attachmentsDisabledReason,
		allowAttachmentOnlySend = false,
		dropScope = 'window',
		onScreenshot,
		onSend,
		onEmptySubmit,
		onRequestHandoff,
		onAttachmentRejected,
		actionsLeft,
		actionsRight,
		notice,
		class: className = '',
		contentClass
	}: {
		/** Shown while the composer is empty */
		suggestions?: Array<{ text: string; label: string }>;
		placeholder?: string;
		/** Placeholder while suggestions are hidden */
		placeholderNoSuggestions?: string;
		/** Rotated through in compact mode */
		placeholders?: string[];
		/** Accessible input name when it differs from the visible placeholder */
		inputLabel?: string;
		showCameraButton?: boolean;
		showFileButton?: boolean;
		showHandoffButton?: boolean;
		compact?: boolean;
		/**
		 * Whether a human answers this thread, so nothing is waiting on a model.
		 * True both for a thread handed off to the team and for one that never had
		 * an agent in front of it. Do not read it as "handed off": a support build
		 * with the agent switched off sets it on threads the team has not seen.
		 */
		isHumanOnly?: boolean;
		isRateLimited?: boolean;
		/**
		 * Whether the user may not write here at all, as opposed to waiting on a
		 * reply. Disables the field, sending, and every way to add a file.
		 */
		disabled?: boolean;
		/**
		 * Why files cannot be attached right now, shown while set. New files are
		 * refused and files already selected cannot be sent until this clears or
		 * they are removed; text alone still sends.
		 */
		attachmentsDisabledReason?: string;
		/** Whether selected files may be sent without any text */
		allowAttachmentOnlySend?: boolean;
		/** Where dropped files are captured: the whole window, or only on the composer */
		dropScope?: 'window' | 'composer';
		onScreenshot?: () => void;
		/**
		 * Dispatches the prompt. Required: the composer clears its input and
		 * settles the send as accepted once this returns, so a composer without it
		 * would drop the message.
		 */
		onSend: (prompt: string) => Promise<void> | void;
		/** Called when the user submits a composer with no text and no files */
		onEmptySubmit?: () => void;
		onRequestHandoff?: () => void;
		/**
		 * Receives every refused or failed file in place of the default toasts, so
		 * the caller can show it persistently, for example through `notice`.
		 */
		onAttachmentRejected?: (rejection: { filename: string; reason: string }) => void;
		actionsLeft?: Snippet<[defaults: Snippet]>;
		actionsRight?: Snippet<[defaults: Snippet]>;
		/** Persistent feedback shown above the composer while set */
		notice?: Snippet;
		class?: string;
		/** Classes for the compact layout's wrapper around the field and its actions */
		contentClass?: string;
	} = $props();

	const ctx = getChatUIContext();
	// Fixed for the context's lifetime, like the upload config it comes from.
	const profile = ctx.uploadProfile;
	const acceptedFiles = acceptAttribute(profile);

	let containerEl = $state<HTMLDivElement>();
	let fileInputEl = $state<HTMLInputElement>();
	let placeholderIndex = $state(0);
	let placeholderTimer: ReturnType<typeof setInterval> | undefined;
	const focusComposer = () => containerEl?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
	ctx.registerComposerFocus(focusComposer);
	// A screenshot reaches the context from the caller, not through this composer.
	ctx.registerAttachmentRefusal(rejectPreparedAttachment);

	// A human-only thread does not block the input: its sends are fire and forget
	const isBusy = $derived(ctx.isProcessing && !isHumanOnly);
	const acceptsAttachments = $derived(!disabled && !attachmentsDisabledReason);
	// At the cap the file controls stay hoverable and focusable, so their tooltip
	// can say why nothing happens; a real `disabled` would swallow both.
	const atAttachmentCap = $derived(acceptsAttachments && !ctx.canAddAttachment);
	const canAddFiles = $derived(acceptsAttachments && ctx.canAddAttachment);
	const attachmentLimitHint = $derived(
		$t('chat.tooltip.attachment_limit', { max: ctx.maxAttachments })
	);
	// Shut again whenever a gate changes, so a menu opened before a gate closed
	// neither outlives it nor reopens by itself when the gate lifts.
	let attachMenuOpen = $derived.by(() => {
		void canAddFiles;
		return false;
	});
	let attachmentLimitHintOpen = $state(false);
	const hasText = $derived(!!ctx.inputValue.trim());
	const hasAttachments = $derived(ctx.attachments.length > 0);
	// Every gate a submission passes, whatever it carries. Uploading and failed
	// files count as content, so an empty composer never waits on them.
	const submitOpen = $derived(
		!disabled &&
			!isBusy &&
			!isRateLimited &&
			ctx.sendGatesOpen &&
			(!attachmentsDisabledReason || !hasAttachments)
	);
	const canSend = $derived(submitOpen && (hasText || (allowAttachmentOnlySend && hasAttachments)));
	const canSubmitEmpty = $derived(submitOpen && !!onEmptySubmit && !hasText && !hasAttachments);

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
	// The key derives from the content, so the index resets only when the copy
	// changes (locale or thread switch), not on every re-derivation of the same list
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
		ctx.unregisterAttachmentRefusal(rejectPreparedAttachment);
	});

	const lastAssistantComplete = $derived.by(() => {
		const last = ctx.displayMessages.findLast((m) => m.role === 'assistant');
		return last?.status === 'success' || last?.status === 'failed';
	});

	// Sticky: once shown, the handoff button stays for the session
	let hasShownHandoffButton = $state(false);

	$effect(() => {
		if (lastAssistantComplete && !hasShownHandoffButton) {
			hasShownHandoffButton = true;
		}
	});

	async function handleSend() {
		if (!canSend) {
			if (canSubmitEmpty) {
				haptic.trigger('medium');
				onEmptySubmit?.();
			}
			return;
		}
		haptic.trigger('medium');
		const snapshot = ctx.captureSendSnapshot();
		const prompt = snapshot.inputValue.trim();
		ctx.clearInputForSend(snapshot);
		// The surface's owner outlives this component, so the outcome is settled
		// even when the composer unmounts before the transport answers.
		const settle = ctx.beginSend(snapshot);
		try {
			// onSend runs before the attachments clear, so consumers can capture their
			// exact transport payload synchronously. The pending send owns them from here
			// even when onSend throws before returning.
			let sendPromise: Promise<void> | void;
			try {
				sendPromise = onSend(prompt);
			} finally {
				ctx.clearAttachmentsForSend(snapshot);
			}
			await sendPromise;
			settle('accepted');
		} catch {
			if (ctx.isSendSnapshotCurrent(snapshot)) console.error('[ChatInput] Send failed');
			settle('refused');
		}
	}

	function handleValueChange(value: string) {
		ctx.setInputValue(value);
	}

	// This and openFilePicker check the gates again: a menu item rendered before
	// a gate closed can still be chosen until the menu leaves the screen.
	function handleCameraClick() {
		if (canAddFiles) onScreenshot?.();
	}

	/**
	 * Keeps a file control at the cap from acting. It runs in the capture phase,
	 * so the picker trigger wrapped around the paperclip never sees the click.
	 */
	function holdAtCap(event: MouseEvent) {
		if (!atAttachmentCap) return;
		event.preventDefault();
		event.stopPropagation();
	}

	function openFilePicker() {
		if (canAddFiles) fileInputEl?.click();
	}

	function handleFileInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		void handleFilesAdded(Array.from(input.files ?? []));
		input.value = '';
	}

	// The compact layout switches once the text wraps: the pill (rounded-full,
	// inline actions) becomes a rounded box with the action row below the
	// textarea. Wrapping is re-measured on every input and layout change.
	let compactWrapper: HTMLDivElement | undefined = $state();
	let compactMultiline = $state(false);
	// True once the textarea content exceeds its max height and scrolls
	// internally. The overflowing text then fades into the composer background at
	// both edges instead of clipping hard.
	let compactScrollable = $state(false);
	// Wrap detection must not read the textarea's live geometry: switching the
	// layout changes the field's width (inline actions vs full row), so the same
	// text can wrap in the pill but fit expanded, and geometry-based checks
	// oscillate at that boundary. Canvas measureText against the field width of the
	// pill layout gives a layout-independent reference, so the decision is stable.
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

	// Re-measures after every value change once the DOM settled: typing, paste,
	// draft restore, and ?prompt= prefill alike.
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

	// Drag and drop for the compact composer, on the window or on the composer
	// alone. The non-compact path gets this from <FileUpload>. A dropped file must
	// attach here, or the browser navigates away to open it.
	const dropEnabled = $derived(compact && showFileButton && !isRateLimited && acceptsAttachments);
	// Starts over whenever eligibility or scope changes: a drag refused midway
	// skips its own leave and drop, and must not revive the overlay once files
	// are accepted again.
	let drag = $derived.by(() => {
		void dropEnabled;
		void dropScope;
		return { depth: 0, active: false };
	});

	/**
	 * Whether this drag belongs to the compact handlers in `scope`. On the
	 * composer alone, a drag without files (selected text, a link) stays with
	 * the browser so it can still be dropped into the field.
	 */
	function handlesDrag(event: DragEvent, scope: 'window' | 'composer'): boolean {
		if (!dropEnabled || dropScope !== scope) return false;
		return scope === 'window' || !!event.dataTransfer?.types.includes('Files');
	}

	/**
	 * A compact composer that cannot take a file right now still keeps one
	 * dropped in its scope from the browser, which would otherwise open the file
	 * in place of the page and its draft. The window is only claimed by a
	 * composer that shows file controls at all.
	 */
	function refuseFileDrop(event: DragEvent, scope: 'window' | 'composer') {
		if (!compact || dropScope !== scope || !event.dataTransfer?.types.includes('Files')) return;
		if (scope === 'window' && !showFileButton) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'none';
	}

	function handleDragEnter(event: DragEvent, scope: 'window' | 'composer') {
		if (!handlesDrag(event, scope)) return;
		event.preventDefault();
		drag = {
			depth: drag.depth + 1,
			active: drag.active || !!event.dataTransfer?.types.includes('Files')
		};
	}

	function handleDragOver(event: DragEvent, scope: 'window' | 'composer') {
		if (!handlesDrag(event, scope)) return refuseFileDrop(event, scope);
		event.preventDefault();
	}

	function handleDragLeave(event: DragEvent, scope: 'window' | 'composer') {
		if (!handlesDrag(event, scope)) return;
		event.preventDefault();
		const depth = drag.depth - 1;
		drag = depth > 0 ? { depth, active: drag.active } : { depth: 0, active: false };
	}

	function handleDrop(event: DragEvent, scope: 'window' | 'composer') {
		if (!handlesDrag(event, scope)) return refuseFileDrop(event, scope);
		event.preventDefault();
		drag = { depth: 0, active: false };
		const files = event.dataTransfer?.files;
		if (files?.length) void handleFilesAdded(Array.from(files));
	}

	function composerDragTarget(node: HTMLElement) {
		const listeners = [
			on(node, 'dragenter', (event) => handleDragEnter(event, 'composer')),
			on(node, 'dragover', (event) => handleDragOver(event, 'composer')),
			on(node, 'dragleave', (event) => handleDragLeave(event, 'composer')),
			on(node, 'drop', (event) => handleDrop(event, 'composer'))
		];
		return () => {
			for (const remove of listeners) remove();
		};
	}

	/** A generic browser type counts as the type its extension maps to. */
	function isAllowedKind(file: File): boolean {
		const mime = profileMimeType(profile, file.name, file.type);
		return mime !== undefined && acceptsMimeType(profile, mime);
	}

	/**
	 * Infers an empty or generic `File.type` from the extension before the rest of
	 * the pipeline sees the file. Without it a Finder-dragged `.png` arrives as `''`,
	 * skips processImage, uploads as `application/octet-stream`, and the server
	 * rejects it. `isAllowedKind` and the composer's final check use the same
	 * inference.
	 */
	function normalizeMime(file: File): File {
		const mime = profileMimeType(profile, file.name, file.type);
		if (!mime || mime === file.type) return file;
		return new File([file], file.name, { type: mime, lastModified: file.lastModified });
	}

	/**
	 * Routes image files through processImage (resize and WebP encode on a worker)
	 * before the upload. The preprocess callback runs inside ctx.uploadFile after
	 * the placeholder attachment is inserted, so canSend, hasFile and the
	 * attachment cap see the attachment during the encode.
	 */
	function attachFile(file: File | Blob, filename: string) {
		if (file.type?.startsWith('image/')) {
			ctx.uploadFile(file, filename, {
				onPreprocessFailed: rejectPreparedAttachment,
				preprocess: async (input) => {
					const processed = await processImage(input);
					// WebP at q=85 is almost always smaller than the source for screenshots and
					// large photos, but heavily compressed JPEGs or small high-detail tiles can
					// re-encode larger, GIFs and failed encodes come back unchanged, and the
					// encoded type need not be one this surface accepts. The limit and the type
					// hold for what is uploaded:
					//   - when neither the encoded output nor the original passes, refuse: the
					//     input cap allows up to MAX_INPUT_IMAGE_SIZE, so the original may be too
					//     big as well.
					//   - otherwise fall back to the original that passes.
					const limit = imageUploadLimit(profile);
					const passes = (blob: Blob, mimeType: string) =>
						acceptsMimeType(profile, mimeType) && blob.size <= limit.bytes;
					if (!passes(processed.blob, processed.mimeType)) {
						if (!passes(input, input.type)) {
							throw new AttachmentRefusal(
								$t('chat.error.image_compression_exceeded', { maxSize: limit.label })
							);
						}
						return {
							blob: input,
							mimeType: input.type,
							filename
							// ctx.uploadFile reads width and height off the original blob
						};
					}
					return {
						blob: processed.blob,
						mimeType: processed.mimeType,
						// The filename follows the actual MIME type, not the passthrough flag: the
						// main-thread fallback also encodes WebP, and WebP bytes must not carry a
						// .png or .jpg name.
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
		ctx.uploadFile(file, filename, { onPreprocessFailed: rejectPreparedAttachment });
	}

	/**
	 * Feedback for a file the coordinator refused after it was added. That
	 * settles later, so this reads the rejection handler current by then.
	 */
	function rejectPreparedAttachment(filename: string, refusal?: AttachmentRefusal) {
		rejectAttachment(
			filename,
			refusal?.message ?? $t('chat.error.upload_failed', { filename }),
			refusal?.description
		);
	}

	/** One owner for refused files: the caller's handler when set, a toast otherwise. */
	function rejectAttachment(filename: string, title: string, description?: string) {
		if (!onAttachmentRejected) {
			if (description) toast.error(title, { description });
			else toast.error(title);
			return;
		}
		const reason = description
			? $t('chat.error.reason_with_detail', { reason: title, detail: description })
			: title;
		onAttachmentRejected({ filename, reason });
	}

	async function handleFilesAdded(files: File[]) {
		if (!acceptsAttachments) return;
		// The context runs duplicate detection and size validation
		for (const raw of files) {
			if (!ctx.canAddAttachment) {
				haptic.trigger('error');
				rejectAttachment(raw.name, $t('chat.error.max_attachments', { max: ctx.maxAttachments }));
				// One toast covers the batch; a handler hears about every file.
				if (!onAttachmentRejected) break;
				continue;
			}

			// Drag and drop bypasses the picker's `accept` filter, so without this gate
			// HEIC or TIFF would reach processImage and waste an upload before the server
			// rejects it.
			if (!isAllowedKind(raw)) {
				haptic.trigger('error');
				rejectAttachment(raw.name, $t('chat.error.file_type_not_allowed', { filename: raw.name }));
				continue;
			}

			// Normalized before the size and branch checks, so attachFile sees a real MIME
			// type and routes images through processImage
			const file = normalizeMime(raw);

			const isImage = file.type.startsWith('image/');
			const cap = isImage ? MAX_INPUT_IMAGE_SIZE : profile.maxBytes;
			const label = isImage ? MAX_INPUT_IMAGE_SIZE_LABEL : profile.maxBytesLabel;

			if (file.size > cap) {
				haptic.trigger('error');
				rejectAttachment(
					file.name,
					$t('chat.error.file_too_large', { filename: file.name }),
					$t('chat.error.file_max_size', { maxSize: label })
				);
				continue;
			}

			if (!ctx.hasFile(file.name, file.size)) {
				haptic.trigger('medium');
				// Fire and forget: the context tracks progress
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
		if (disabled) return;
		ctx.setInputValue(text);
		tick().then(() => {
			containerEl?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
		});
	}

	/** The pasted file's own name, or one made up from its type. */
	function pastedFilename(file: File): string {
		return (
			file.name ||
			`pasted-${file.type.startsWith('image/') ? 'image' : 'file'}-${Date.now()}.${file.type.split('/')[1] || 'bin'}`
		);
	}

	function handlePaste(event: ClipboardEvent) {
		// Text still pastes into the field; only file items are refused.
		if (!showFileButton || !acceptsAttachments) return;
		const items = event.clipboardData?.items;
		if (!items) return;

		for (const item of items) {
			// String items such as pasted text fall through to the textarea's default
			// paste handling.
			if (item.kind !== 'file') continue;

			const raw = item.getAsFile();
			if (!raw) continue;

			// A pasted file's clipboard type is often empty or generic (notably .md and
			// .txt), so the gate checks the extension fallback like handleFilesAdded.
			// Without a rejection handler the refusal stays silent.
			if (!isAllowedKind(raw)) {
				if (onAttachmentRejected) {
					const filename = pastedFilename(raw);
					rejectAttachment(filename, $t('chat.error.file_type_not_allowed', { filename }));
				}
				continue;
			}

			// An empty or generic MIME type is inferred from the extension before branching,
			// so attachFile routes images through processImage and text files upload with
			// the right Content-Type.
			const file = normalizeMime(raw);
			const filename = pastedFilename(file);

			if (!ctx.canAddAttachment) {
				haptic.trigger('error');
				rejectAttachment(filename, $t('chat.error.max_attachments', { max: ctx.maxAttachments }));
				// One toast covers the batch; a handler hears about every file.
				if (!onAttachmentRejected) break;
				continue;
			}

			// Images shrink through processImage before upload, so only the input ceiling
			// applies to them. Other files upload as they are, so the profile's storage cap
			// applies to the input.
			const isImage = file.type.startsWith('image/');
			const cap = isImage ? MAX_INPUT_IMAGE_SIZE : profile.maxBytes;
			const label = isImage ? MAX_INPUT_IMAGE_SIZE_LABEL : profile.maxBytesLabel;

			if (file.size > cap) {
				rejectAttachment(
					filename,
					$t('chat.error.pasted_file_too_large'),
					$t('chat.error.file_max_size', { maxSize: label })
				);
				continue;
			}

			// Duplicates are unlikely for pasted files; the check matches the file upload path
			if (!ctx.hasFile(filename, file.size)) {
				attachFile(file, filename);
			}
		}
	}
</script>

<svelte:window
	ondragenter={(event) => handleDragEnter(event, 'window')}
	ondragover={(event) => handleDragOver(event, 'window')}
	ondragleave={(event) => handleDragLeave(event, 'window')}
	ondrop={(event) => handleDrop(event, 'window')}
/>

{#snippet defaultLeftActions()}
	{#if compact && (showFileButton || showCameraButton)}
		<!-- The menu holds only file actions: at the cap it stays shut and the
		     trigger's tooltip names the limit instead. -->
		<DropdownMenu.Root
			bind:open={() => attachMenuOpen, (open) => (attachMenuOpen = open && canAddFiles)}
		>
			<Tooltip.Root
				bind:open={
					() => attachmentLimitHintOpen && atAttachmentCap,
					(open) => (attachmentLimitHintOpen = open)
				}
			>
				<Tooltip.Trigger>
					{#snippet child({ props: tooltipProps })}
						<DropdownMenu.Trigger {...tooltipProps} disabled={!acceptsAttachments}>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									size="icon"
									shape="pill"
									aria-disabled={atAttachmentCap || undefined}
									aria-label={$t('chat.tooltip.more_actions')}
								>
									<!-- A ghost button is only its icon at rest, so dimming the icon reads as disabled. -->
									<PlusIcon
										class={['size-4.5', atAttachmentCap && 'opacity-50']}
										aria-hidden="true"
									/>
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content side="top" class="z-250">
					<p>{attachmentLimitHint}</p>
				</Tooltip.Content>
			</Tooltip.Root>
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
				accept={acceptedFiles}
				hidden
				aria-hidden="true"
				tabindex="-1"
				disabled={!acceptsAttachments}
				onchange={handleFileInput}
			/>
		{/if}
	{:else}
		{#if showCameraButton}
			<PromptInputAction>
				{#snippet tooltip()}
					<p>{atAttachmentCap ? attachmentLimitHint : $t('chat.tooltip.mark_bug')}</p>
				{/snippet}
				{#snippet children(props)}
					<ComposerAttachmentButton
						{...props}
						disabled={!acceptsAttachments}
						aria-disabled={atAttachmentCap || undefined}
						onclickcapture={holdAtCap}
						onclick={handleCameraClick}
						aria-label={$t('chat.tooltip.mark_bug')}
					>
						<CameraIcon class="h-4.5 w-4.5" />
					</ComposerAttachmentButton>
				{/snippet}
			</PromptInputAction>
		{/if}
		{#if showFileButton}
			<FileUpload
				onFilesAdded={handleFilesAdded}
				multiple={true}
				accept={acceptedFiles}
				disabled={!acceptsAttachments}
				dropScope={dropScope === 'window' ? 'window' : (containerEl ?? null)}
			>
				<PromptInputAction>
					{#snippet tooltip()}
						<p>{atAttachmentCap ? attachmentLimitHint : $t('chat.tooltip.attach_files')}</p>
					{/snippet}
					{#snippet children(props)}
						<FileUploadTrigger asChild={true}>
							<ComposerAttachmentButton
								{...props}
								disabled={!acceptsAttachments}
								aria-disabled={atAttachmentCap || undefined}
								onclickcapture={holdAtCap}
								aria-label={$t('chat.tooltip.attach_files')}
							>
								<PaperclipIcon class="h-4.5 w-4.5" />
							</ComposerAttachmentButton>
						</FileUploadTrigger>
					{/snippet}
				</PromptInputAction>
			</FileUpload>
		{/if}
	{/if}
{/snippet}

{#snippet leftActions()}
	<div class="flex items-center gap-2">
		{#if actionsLeft}
			{@render actionsLeft(defaultLeftActions)}
		{:else}
			{@render defaultLeftActions()}
		{/if}
	</div>
{/snippet}

{#snippet defaultRightActions()}
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
			shape="pill"
			disabled={!canSend && !canSubmitEmpty}
			onclick={handleSend}
			aria-label={$t('chat.aria.send')}
			data-testid="chat-input-send"
		>
			{#if ctx.isProcessing && !isHumanOnly}
				<LoaderCircleIcon class="h-4.5 w-4.5 motion-safe:animate-spin" />
			{:else}
				<ArrowUpIcon class="h-4.5 w-4.5" />
			{/if}
		</Button>
	</div>
{/snippet}

{#snippet rightActions()}
	{#if actionsRight}
		{@render actionsRight(defaultRightActions)}
	{:else}
		{@render defaultRightActions()}
	{/if}
{/snippet}

<div bind:this={containerEl} class={className} {@attach composerDragTarget}>
	<!-- isNewConversation shows suggestions at once for draft threads. messagesReady
	     waits for the query on existing threads, which prevents a flash. -->
	{#if showSuggestions}
		<div class="pb-2">
			{#key ctx.core.threadGeneration}
				<div class="flex flex-wrap gap-2">
					{#each suggestions as suggestion, i (suggestion.text)}
						<div
							class="max-w-full min-w-0 motion-safe:animate-chip-in motion-safe:animation-delay-var sm:max-w-56"
							style:--delay="{i * 50}ms"
						>
							<PromptSuggestion
								class="w-full"
								truncate
								title={suggestion.text}
								{disabled}
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
	{#if ctx.exceedsMessageLength || ctx.exceedsAttachmentLimit || attachmentsDisabledReason || notice}
		<!-- Persistent, not a toast: each of these needs the user to notice it. -->
		<div
			role="status"
			class="flex flex-col gap-0.5 px-3 pb-2 text-xs"
			data-testid="chat-input-notice"
		>
			{#if ctx.exceedsMessageLength || ctx.exceedsAttachmentLimit}
				<div class="flex flex-col gap-0.5 text-destructive" data-testid="chat-input-limit-notice">
					{#if ctx.exceedsMessageLength}
						<p>{$t('chat.notices.message_too_long', { max: MAX_MESSAGE_LENGTH })}</p>
					{/if}
					{#if ctx.exceedsAttachmentLimit}
						<p>{$t('chat.notices.too_many_attachments', { max: ctx.maxAttachments })}</p>
					{/if}
				</div>
			{/if}
			{#if attachmentsDisabledReason}
				<p class="text-muted-foreground" data-testid="chat-input-attachments-unavailable">
					{attachmentsDisabledReason}
				</p>
			{/if}
			{@render notice?.()}
		</div>
	{/if}
	<!-- Fixed 25px radius: the one-line pill is 48px tall (36px field + 12px
	     padding) plus its border, so 25px is fully round there and stays put when
	     the field grows, with no radius jump between layouts. -->
	<!-- Input focus uses the text caret without a ring around the composer. Action
	     buttons keep their own focus indicators. -->
	<PromptInput
		class={compact
			? `relative z-20 rounded-[25px] border-0 bg-popover composer-elevation ${compactMultiline ? 'p-0' : 'p-1.5'}`
			: 'relative z-20 bg-popover p-0'}
		value={ctx.inputValue}
		isLoading={ctx.core.isSending}
		onValueChange={handleValueChange}
		onSubmit={handleSend}
	>
		{#if compact}
			<div class={cn('relative flex min-w-0 flex-col', contentClass)} bind:this={compactWrapper}>
				{#if drag.active && dropEnabled && !atAttachmentCap}
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
				<!-- Single line: actions inline beside the textarea (pill). Multi-line: the
				     textarea spans the full width and the actions drop to a row below. Only
				     the action bars move between branches; the textarea never remounts, so
				     focus and caret survive the layout switch mid-typing. -->
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
							layout="compact"
							multiline={compactMultiline}
							scrollMask={compactScrollable}
							{disabled}
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
					layout="full"
					{disabled}
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
