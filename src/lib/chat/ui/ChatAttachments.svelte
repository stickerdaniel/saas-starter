<script lang="ts">
	import { X, File as FileIcon, Image as ImageIcon, LoaderCircle } from '@lucide/svelte';
	import Progress from '$lib/components/ui/progress/progress.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import type { Attachment, UploadState } from '../core/types.js';

	let {
		attachments = [],
		onRemove,
		columns = 2,
		readonly = false,
		class: className = ''
	}: {
		attachments?: Attachment[];
		onRemove?: (index: number) => void;
		columns?: number;
		readonly?: boolean;
		class?: string;
	} = $props();

	let isDialogOpen = $state(false);
	let selectedAttachment = $state<Attachment | null>(null);

	/**
	 * Get filename from attachment
	 */
	function getFilename(attachment: Attachment): string {
		if (attachment.type === 'file') return attachment.name;
		if (attachment.type === 'screenshot') return attachment.name;
		if (attachment.type === 'image') return attachment.filename || 'Image';
		if (attachment.type === 'remote-file') return attachment.filename;
		return 'Attachment';
	}

	/**
	 * Check if attachment has a preview image
	 */
	function hasPreview(attachment: Attachment): string | undefined {
		if (attachment.type === 'file') return attachment.preview || attachment.url;
		if (attachment.type === 'screenshot') return attachment.preview || attachment.url;
		if (attachment.type === 'image') return attachment.url;
		return undefined;
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
		if (attachment.type === 'image' || attachment.type === 'remote-file') {
			selectedAttachment = attachment;
			isDialogOpen = true;
		}
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
</script>

<Dialog.Root bind:open={isDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title
				>{selectedAttachment ? getFilename(selectedAttachment) : 'Attachment'}</Dialog.Title
			>
		</Dialog.Header>
		{#if selectedAttachment}
			{#if selectedAttachment.type === 'image'}
				<img
					src={selectedAttachment.url}
					alt={selectedAttachment.filename}
					class="mx-auto max-h-[70vh] max-w-full rounded-md object-contain"
				/>
			{:else if selectedAttachment.type === 'remote-file'}
				{#if selectedAttachment.contentType?.startsWith('image/')}
					<img
						src={selectedAttachment.url}
						alt={selectedAttachment.filename}
						class="max-h-[70vh] rounded-md object-contain"
					/>
				{:else}
					<iframe
						src={selectedAttachment.url}
						title={selectedAttachment.filename}
						class="h-[70vh] w-full rounded-md"
					></iframe>
				{/if}
			{/if}
		{/if}
	</Dialog.Content>
</Dialog.Root>

{#if attachments.length > 0}
	<div
		class="flex flex-wrap gap-2 {className}"
		style="flex-direction: {readonly ? 'row-reverse' : 'row'}; flex-wrap: {readonly
			? 'wrap-reverse'
			: 'wrap'}; justify-content: flex-start; align-content: flex-end;"
	>
		{#each readonly ? [...attachments].reverse() : attachments as attachment, index (getKey(attachment))}
			{@const preview = hasPreview(attachment)}
			{@const filename = getFilename(attachment)}
			{@const isClickable = attachment.type === 'image' || attachment.type === 'remote-file'}
			{@const originalIndex = readonly ? attachments.length - 1 - index : index}
			{@const uploadState = getUploadState(attachment)}

			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="relative flex items-center justify-between gap-2 overflow-hidden rounded-lg px-2 py-2 {isClickable
					? 'cursor-pointer'
					: ''} {readonly ? 'border text-foreground transition-colors' : 'bg-secondary/50'}"
				style="width: {attachments.length === 1 && readonly
					? '100%'
					: 'calc(50% - 0.25rem)'}; box-sizing: border-box;"
				onclick={() => isClickable && handleOpen(attachment)}
			>
				<div class="flex flex-1 items-center gap-2 overflow-hidden">
					<div
						class="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded bg-red-500 text-[#fafafa]"
					>
						{#if uploadState?.status === 'uploading'}
							<LoaderCircle class="size-4 shrink-0 animate-spin" />
						{:else if preview}
							<img src={preview} alt={filename} class="size-8 rounded object-cover" />
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
						aria-label="Remove {filename}"
					>
						<X class="size-4" />
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
