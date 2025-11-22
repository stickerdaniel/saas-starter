<script lang="ts">
	import { X, File as FileIcon, Image as ImageIcon } from '@lucide/svelte';

	/**
	 * Unified attachment type supporting both files and screenshots
	 */
	export type Attachment =
		| { type: 'file'; file: File; preview?: string }
		| { type: 'screenshot'; blob: Blob; filename: string }
		| { type: 'image'; url: string; filename?: string }
		| { type: 'remote-file'; url: string; filename: string; contentType?: string };

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

	/**
	 * Get filename from attachment
	 */
	function getFilename(attachment: Attachment): string {
		if (attachment.type === 'file') return attachment.file.name;
		if (attachment.type === 'screenshot') return attachment.filename;
		if (attachment.type === 'image') return attachment.filename || 'Image';
		if (attachment.type === 'remote-file') return attachment.filename;
		return 'Attachment';
	}

	/**
	 * Check if attachment has a preview image
	 */
	function hasPreview(attachment: Attachment): string | undefined {
		if (attachment.type === 'file') return attachment.preview;
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
		if (attachment.type === 'file') return `file-${attachment.file.name}-${attachment.file.size}`;
		if (attachment.type === 'screenshot') return `screenshot-${attachment.filename}`;
		if (attachment.type === 'image') return `image-${attachment.url}`;
		if (attachment.type === 'remote-file') return `remote-${attachment.url}`;
		return `attachment-${Math.random()}`;
	}

	function handleOpen(attachment: Attachment) {
		if (attachment.type === 'image' || attachment.type === 'remote-file') {
			window.open(attachment.url, '_blank');
		}
	}
</script>

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

			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="flex items-center justify-between gap-2 rounded-lg px-2 py-2 {isClickable
					? 'cursor-pointer'
					: ''} {readonly ? 'border text-foreground transition-colors' : 'bg-secondary/50'}"
				style="width: {attachments.length === 1 && readonly
					? '100%'
					: 'calc(50% - 0.25rem)'}; box-sizing: border-box;"
				onclick={() => isClickable && handleOpen(attachment)}
			>
				<div class="flex items-center gap-2 overflow-hidden">
					<div
						class="flex size-8 items-center justify-center overflow-hidden rounded bg-red-500 text-[#fafafa]"
					>
						{#if preview}
							<img src={preview} alt={filename} class="size-8 rounded object-cover" />
						{:else if isScreenshot(attachment)}
							<ImageIcon class="size-4 shrink-0" />
						{:else}
							<FileIcon class="size-4 shrink-0" />
						{/if}
					</div>
					<span class="max-w-[80px] truncate text-sm" title={filename}>{filename}</span>
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
			</div>
		{/each}
	</div>
{/if}
