<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import FileIcon from '@lucide/svelte/icons/file';
	import ImageIcon from '@lucide/svelte/icons/image';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { getTranslate } from '@tolgee/svelte';
	import Progress from '$lib/components/ui/progress/progress.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import type { Attachment, UploadState } from '../core/types.js';
	import type { ChatAlignment } from './ChatContext.svelte.js';

	const { t } = getTranslate();

	let {
		attachments = [],
		onRemove,
		columns: _columns = 2,
		readonly = false,
		align = 'right',
		class: className = ''
	}: {
		attachments?: Attachment[];
		onRemove?: (index: number) => void;
		columns?: number;
		readonly?: boolean;
		/** Alignment - controls flex direction for readonly attachments */
		align?: ChatAlignment;
		class?: string;
	} = $props();

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
		class={displayDimensions ? '!max-w-none' : ''}
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
				<iframe
					src={openUrl}
					title={getFilename(selectedAttachment)}
					class="h-[70vh] w-full rounded-md"
				></iframe>
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
		{#each readonly && align === 'right' ? [...attachments].reverse() : attachments as attachment, index (getKey(attachment))}
			{@const thumbnailUrl = getThumbnailUrl(attachment)}
			{@const filename = getFilename(attachment)}
			{@const uploadState = getUploadState(attachment)}
			{@const isUploading = uploadState?.status === 'uploading'}
			{@const isClickable = !isUploading && canOpen(attachment)}
			{@const originalIndex =
				readonly && align === 'right' ? attachments.length - 1 - index : index}

			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="relative flex items-center justify-between gap-2 overflow-hidden rounded-lg px-2 py-2 transition-transform {isClickable
					? 'cursor-pointer active:scale-97'
					: ''} {readonly ? 'border text-foreground transition-colors' : 'bg-secondary/50'}"
				style="width: {attachments.length === 1 && readonly
					? '100%'
					: 'calc(50% - 0.25rem)'}; box-sizing: border-box;"
				onclick={() => isClickable && handleOpen(attachment)}
			>
				<div class="flex flex-1 items-center gap-2 overflow-hidden">
					<div
						class="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded bg-primary/15 text-muted-foreground"
					>
						{#if uploadState?.status === 'uploading'}
							<LoaderCircleIcon class="size-4 shrink-0 animate-spin" />
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
					<div class="flex flex-1 flex-col gap-1 overflow-hidden">
						<span class="truncate text-sm" title={filename}>{filename}</span>
					</div>
				</div>
				{#if !readonly}
					<button
						onclick={(e) => {
							e.stopPropagation();
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
