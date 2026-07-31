<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import FileIcon from '@lucide/svelte/icons/file';
	import ImageIcon from '@lucide/svelte/icons/image';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { getTranslate } from '@tolgee/svelte';
	import { haptic } from '$lib/hooks/use-haptic.svelte.ts';
	import Progress from '$lib/components/ui/progress/progress.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import AttachmentTextPreview from './AttachmentTextPreview.svelte';
	import { isTextPreviewable } from '../core/attachmentPreview.js';
	import type { Attachment, UploadState } from '../core/types.js';
	import type { UploadErrorCode } from '../core/file-uploader.js';
	import type { ChatAlignment } from './chat-context.svelte.ts';

	const { t } = getTranslate();

	let {
		attachments = [],
		onRemove,
		onRetry,
		columns: _columns = 2,
		readonly = false,
		align = 'right',
		class: className = ''
	}: {
		attachments?: Attachment[];
		onRemove?: (index: number) => void;
		/** Retry a failed upload. Without it, a failure offers only discard. */
		onRetry?: (index: number) => void;
		columns?: number;
		readonly?: boolean;
		/** Alignment - controls flex direction for readonly attachments */
		align?: ChatAlignment;
		class?: string;
	} = $props();

	/**
	 * Translation key per failure cause. Written out in full so the orphan-key
	 * check can see the references; a template-built key would look unused.
	 * `parse` shares the server wording: a malformed response is a server fault,
	 * and retrying is the only thing the user can do about either.
	 */
	const UPLOAD_ERROR_KEY: Record<UploadErrorCode, string> = {
		network: 'chat.error.upload_network',
		http: 'chat.error.upload_server',
		parse: 'chat.error.upload_server',
		server: 'chat.error.upload_server'
	};

	/**
	 * The one line a failed tile shows under the filename: what went wrong, and
	 * the way out. There is no automatic retry, so the tile itself is the
	 * control — without a retry handler the file has to be added again.
	 */
	function failureText(code: UploadErrorCode | undefined, retryable: boolean): string {
		const cause = $t(code ? UPLOAD_ERROR_KEY[code] : 'chat.error.upload_server');
		return `${cause} ${$t(retryable ? 'chat.error.upload_retry_hint' : 'chat.error.upload_readd_hint')}`;
	}

	// Tiles pair up two per row from sm upwards. Below that the row is too narrow
	// for a filename plus a failure reason, so each takes the full width. A lone
	// attachment also spans the row: halving it would truncate the reason while
	// the other half sits empty.
	const fullWidthTiles = $derived(attachments.length === 1);

	// Flex direction and wrap based on alignment and readonly state
	const flexDirection = $derived(readonly ? (align === 'right' ? 'row-reverse' : 'row') : 'row');
	const flexWrap = $derived(readonly ? (align === 'right' ? 'wrap-reverse' : 'wrap') : 'wrap');

	let isDialogOpen = $state(false);
	let selectedAttachment = $state<Attachment | null>(null);
	let displayDimensions = $state<{ width: number; height: number } | null>(null);

	/**
	 * Get filename from attachment
	 */
	function getFilename(attachment: Attachment): string {
		if (attachment.type === 'file') return attachment.name;
		if (attachment.type === 'screenshot') return attachment.name;
		if (attachment.type === 'image')
			return attachment.filename || $t('chat.attachment.image_fallback');
		if (attachment.type === 'remote-file') return attachment.filename;
		return $t('chat.attachment.generic_fallback');
	}

	/**
	 * Check if attachment is an image (supports previews/thumbnails)
	 */
	function isImageAttachment(attachment: Attachment): boolean {
		if (attachment.type === 'image') return true;
		if (attachment.type === 'screenshot') return attachment.mimeType?.startsWith('image/');
		if (attachment.type === 'file') return attachment.mimeType?.startsWith('image/');
		if (attachment.type === 'remote-file')
			return attachment.contentType?.startsWith('image/') ?? false;
		return false;
	}

	/**
	 * Get thumbnail URL for image attachments only
	 */
	function getThumbnailUrl(attachment: Attachment): string | undefined {
		if (!isImageAttachment(attachment)) return undefined;
		if (attachment.type === 'image') return attachment.url;
		if (attachment.type === 'screenshot') return attachment.preview || attachment.url;
		if (attachment.type === 'file') return attachment.preview || attachment.url;
		if (attachment.type === 'remote-file') return attachment.url;
		return undefined;
	}

	/**
	 * Get URL to open in preview dialog
	 */
	function getOpenUrl(attachment: Attachment): string | undefined {
		if (isImageAttachment(attachment)) {
			return getThumbnailUrl(attachment) || attachment.url;
		}
		if (attachment.type === 'file') return attachment.url;
		if (attachment.type === 'remote-file') return attachment.url;
		if (attachment.type === 'screenshot') return attachment.url;
		return undefined;
	}

	/**
	 * Check if attachment can be opened
	 */
	function canOpen(attachment: Attachment): boolean {
		return !!getOpenUrl(attachment);
	}

	/**
	 * MIME type for a non-image attachment (drives the text-preview decision).
	 */
	function getMimeType(attachment: Attachment): string | undefined {
		if (attachment.type === 'file') return attachment.mimeType;
		if (attachment.type === 'screenshot') return attachment.mimeType;
		if (attachment.type === 'remote-file') return attachment.contentType;
		return undefined;
	}

	/**
	 * In-memory blob for a freshly attached file, so the preview can read text
	 * locally without a network round-trip. null for already-sent (remote) ones.
	 */
	function getLocalBlob(attachment: Attachment): Blob | null {
		if (attachment.type === 'file') return attachment.file ?? null;
		if (attachment.type === 'screenshot') return attachment.blob ?? null;
		return null;
	}

	/**
	 * Check if attachment is a screenshot
	 */
	function isScreenshot(attachment: Attachment): boolean {
		return attachment.type === 'screenshot';
	}

	/**
	 * Get unique key for attachment
	 */
	function getKey(attachment: Attachment): string {
		if (attachment.type === 'file') return `file-${attachment.name}-${attachment.size}`;
		if (attachment.type === 'screenshot') return `screenshot-${attachment.name}-${attachment.size}`;
		if (attachment.type === 'image') return `image-${attachment.url}`;
		if (attachment.type === 'remote-file') return `remote-${attachment.url}`;
		return `attachment-${Math.random()}`;
	}

	/**
	 * Identity for keyed lists. Composer attachments carry an upload id; prefer
	 * it, because name+size is not unique: two images picked under different
	 * names (photo.jpg, photo.jpeg) pass dedup, then both get renamed to
	 * photo.webp at the same encoded size. Duplicate keys make Svelte throw.
	 * Sent attachments have no id and fall back to the derived key.
	 */
	function attachmentKey(attachment: Attachment): string {
		return ('key' in attachment && attachment.key) || getKey(attachment);
	}

	function handleOpen(attachment: Attachment) {
		const openUrl = getOpenUrl(attachment);
		if (!openUrl) return;

		selectedAttachment = attachment;

		// Pre-compute display dimensions to prevent dialog resize (images only)
		if (isImageAttachment(attachment)) {
			const dims = getDimensions(attachment);
			if (dims.width && dims.height) {
				const maxHeight = window.innerHeight * 0.7; // 70vh
				const maxWidth = Math.min(window.innerWidth * 0.9, 512); // dialog max-width ~512px
				const scale = Math.min(maxWidth / dims.width, maxHeight / dims.height, 1);
				displayDimensions = {
					width: Math.round(dims.width * scale),
					height: Math.round(dims.height * scale)
				};
			} else {
				displayDimensions = null;
			}
		} else {
			displayDimensions = null;
		}

		isDialogOpen = true;
	}

	/**
	 * Get upload state from attachment
	 */
	function getUploadState(attachment: Attachment): UploadState | undefined {
		if (attachment.type === 'file' || attachment.type === 'screenshot') {
			return attachment.uploadState;
		}
		return undefined;
	}

	/**
	 * Get dimensions from attachment (if available)
	 */
	function getDimensions(attachment: Attachment): { width?: number; height?: number } {
		// All attachment types now support width/height
		return { width: attachment.width, height: attachment.height };
	}
</script>

<Dialog.Root bind:open={isDialogOpen}>
	<Dialog.Content
		class={displayDimensions ? '!max-w-none' : 'sm:max-w-4xl'}
		style={displayDimensions ? `width: ${displayDimensions.width + 48}px;` : ''}
	>
		<Dialog.Header>
			<Dialog.Title
				>{selectedAttachment
					? getFilename(selectedAttachment)
					: $t('chat.attachment.dialog_title')}</Dialog.Title
			>
		</Dialog.Header>
		{#if selectedAttachment}
			{@const openUrl = getOpenUrl(selectedAttachment)}
			{@const isImage = isImageAttachment(selectedAttachment)}
			{#if openUrl && !isImage}
				{@const mimeType = getMimeType(selectedAttachment)}
				{#if isTextPreviewable(mimeType, getFilename(selectedAttachment))}
					<AttachmentTextPreview
						url={openUrl}
						{mimeType}
						filename={getFilename(selectedAttachment)}
						blob={getLocalBlob(selectedAttachment)}
					/>
				{:else}
					<iframe
						src={openUrl}
						title={getFilename(selectedAttachment)}
						class="h-[70vh] w-full rounded-md"
					></iframe>
				{/if}
			{:else if openUrl && isImage}
				{#if displayDimensions}
					<div
						class="mx-auto overflow-hidden rounded-md"
						style="width: {displayDimensions.width}px; height: {displayDimensions.height}px;"
					>
						<img
							src={openUrl}
							alt={getFilename(selectedAttachment)}
							class="size-full object-contain"
						/>
					</div>
				{:else}
					<img
						src={openUrl}
						alt={getFilename(selectedAttachment)}
						class="mx-auto max-h-[70vh] max-w-full rounded-md object-contain"
					/>
				{/if}
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>

{#if attachments.length > 0}
	<div
		class="flex flex-wrap gap-2 {className}"
		style="flex-direction: {flexDirection}; flex-wrap: {flexWrap}; justify-content: flex-start; align-content: flex-end;"
	>
		{#each readonly && align === 'right' ? [...attachments].reverse() : attachments as attachment, index (attachmentKey(attachment))}
			{@const thumbnailUrl = getThumbnailUrl(attachment)}
			{@const filename = getFilename(attachment)}
			{@const uploadState = getUploadState(attachment)}
			{@const isUploading = uploadState?.status === 'uploading'}
			{@const hasFailed = uploadState?.status === 'error'}
			{@const originalIndex =
				readonly && align === 'right' ? attachments.length - 1 - index : index}
			<!-- A failed image keeps its local preview, so canOpen() would still
			     say yes; opening it would suggest the file exists somewhere.
			     A failed tile activates the retry instead. -->
			{@const canRetry = hasFailed && !readonly && !!onRetry}
			{@const isClickable = !isUploading && !hasFailed && canOpen(attachment)}
			{@const isInteractive = isClickable || canRetry}
			{@const activate = () => {
				if (canRetry) {
					haptic.trigger('light');
					onRetry?.(originalIndex);
				} else if (isClickable) {
					handleOpen(attachment);
				}
			}}

			<!-- tabindex and role are set together: when interactive, role="button" makes this actionable -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				data-testid="attachment-chip"
				data-upload-failed={hasFailed ? '' : undefined}
				class="relative flex w-full items-center justify-between gap-2 overflow-hidden rounded-lg px-2 py-2 transition-transform {fullWidthTiles
					? ''
					: 'sm:w-[calc(50%-0.25rem)]'} {isInteractive
					? 'cursor-pointer active:translate-y-px'
					: ''} {readonly && !hasFailed
					? 'border text-foreground transition-colors'
					: 'bg-secondary/50'}"
				style="box-sizing: border-box;"
				role={isInteractive ? 'button' : undefined}
				tabindex={isInteractive ? 0 : undefined}
				onclick={activate}
				onkeydown={(e) => {
					if (isInteractive && (e.key === 'Enter' || e.key === ' ')) {
						e.preventDefault();
						activate();
					}
				}}
			>
				<div class="flex flex-1 items-center gap-2 overflow-hidden">
					<div
						class="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded bg-primary/15 text-muted-foreground"
					>
						{#if uploadState?.status === 'uploading'}
							<LoaderCircleIcon class="size-4 shrink-0 motion-safe:animate-spin" />
						{:else if hasFailed}
							<TriangleAlertIcon class="size-4 shrink-0 text-destructive" />
						{:else if thumbnailUrl}
							<img
								src={thumbnailUrl}
								alt={filename}
								class="size-8 rounded object-cover"
								loading="lazy"
								decoding="async"
							/>
						{:else if isScreenshot(attachment)}
							<ImageIcon class="size-4 shrink-0" />
						{:else}
							<FileIcon class="size-4 shrink-0" />
						{/if}
					</div>
					<div class="flex flex-1 flex-col gap-0 overflow-hidden leading-tight">
						<span class="truncate text-sm" title={filename}>{filename}</span>
						{#if hasFailed}
							{@const code = uploadState?.error}
							<span class="truncate text-xs text-destructive" title={failureText(code, canRetry)}>
								{failureText(code, canRetry)}
							</span>
						{/if}
					</div>
				</div>
				{#if !readonly}
					<button
						onclick={(e) => {
							e.stopPropagation();
							haptic.trigger('light');
							onRemove?.(originalIndex);
						}}
						class="shrink-0 rounded-full p-1 hover:bg-secondary/50"
						type="button"
						aria-label={$t('chat.aria.remove_attachment', { filename })}
					>
						<XIcon class="size-4" />
					</button>
				{/if}

				{#if uploadState?.status === 'uploading'}
					<div class="absolute right-0 bottom-0 left-0 h-0.5">
						<Progress value={uploadState.progress} max={100} class="h-full w-full rounded-none" />
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}
