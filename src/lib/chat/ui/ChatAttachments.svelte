<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import FileExclamationPointIcon from '@lucide/svelte/icons/file-exclamation-point';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { getTranslate } from '@tolgee/svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { haptic } from '#lib/hooks/use-haptic.svelte.ts';
	import * as Attachment from '#lib/components/ui/attachment/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import AttachmentTextPreview from './AttachmentTextPreview.svelte';
	import { isTextPreviewable } from '../core/attachmentPreview.js';
	import type { Attachment as ChatAttachment, UploadState } from '../core/types.js';
	import type { UploadErrorCode } from '../../uploads/transfer.js';
	import type { ChatAlignment } from './chat-context.svelte.ts';

	const { t } = getTranslate();

	let {
		attachments = [],
		onRemove,
		onRetry,
		readonly = false,
		align = 'right',
		loadText,
		class: className = ''
	}: {
		attachments?: ChatAttachment[];
		onRemove?: (index: number) => void;
		/** Retry a failed upload. Without it, a failure offers only discard. */
		onRetry?: (index: number) => void;
		/** Sent attachments: no actions, cards stacked on the message's side. */
		readonly?: boolean;
		/** Side a readonly stack aligns to. */
		align?: ChatAlignment;
		/** Text source for previews of attachments without a local blob. */
		loadText?: (attachment: ChatAttachment) => Promise<{ text: string; truncated: boolean }>;
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

	/** The Attachment state each upload status renders as. No upload state means done. */
	const ATTACHMENT_STATE: Record<UploadState['status'], Attachment.AttachmentState> = {
		uploading: 'uploading',
		success: 'done',
		error: 'error'
	};

	/**
	 * The description of a failed upload: what went wrong, plus the way out when
	 * no retry action exists. There is no automatic retry, so without a retry
	 * handler the file has to be added again.
	 */
	function failureText(code: UploadErrorCode | undefined, retryable: boolean): string {
		const cause = $t(code ? UPLOAD_ERROR_KEY[code] : 'chat.error.upload_server');
		return retryable ? cause : `${cause} ${$t('chat.error.upload_readd_hint')}`;
	}

	/** Preview dialog contents by attachment key, for the open-focus handler. */
	const previewContents = new SvelteMap<string, HTMLElement | null>();
	/** Keys of preview dialogs whose title is visually cut off. */
	const truncatedTitles = new SvelteSet<string>();

	function measureTitle(key: string, _filename: string) {
		return (element: HTMLElement) => {
			function update() {
				if (element.scrollWidth > element.clientWidth) truncatedTitles.add(key);
				else truncatedTitles.delete(key);
			}

			update();
			const observer = new ResizeObserver(update);
			observer.observe(element);

			return () => {
				observer.disconnect();
				truncatedTitles.delete(key);
			};
		};
	}

	// The title tooltip trigger would otherwise take focus first and open its tooltip.
	function focusDialogClose(key: string, event: Event) {
		event.preventDefault();
		previewContents.get(key)?.querySelector<HTMLElement>('[data-slot="dialog-close"]')?.focus();
	}

	function getFilename(attachment: ChatAttachment): string {
		if (attachment.type === 'file') return attachment.name;
		if (attachment.type === 'screenshot') return attachment.name;
		if (attachment.type === 'image')
			return attachment.filename || $t('chat.attachment.image_fallback');
		if (attachment.type === 'remote-file') return attachment.filename;
		return $t('chat.attachment.generic_fallback');
	}

	function isImageAttachment(attachment: ChatAttachment): boolean {
		if (attachment.type === 'image') return true;
		if (attachment.type === 'screenshot') return attachment.mimeType?.startsWith('image/');
		if (attachment.type === 'file') return attachment.mimeType?.startsWith('image/');
		if (attachment.type === 'remote-file')
			return attachment.contentType?.startsWith('image/') ?? false;
		return false;
	}

	/** Thumbnail URL for image attachments only. */
	function getThumbnailUrl(attachment: ChatAttachment): string | undefined {
		if (!isImageAttachment(attachment)) return undefined;
		if (attachment.type === 'image') return attachment.url;
		if (attachment.type === 'screenshot') return attachment.preview || attachment.url;
		if (attachment.type === 'file') return attachment.preview || attachment.url;
		if (attachment.type === 'remote-file') return attachment.url;
		return undefined;
	}

	/** URL the preview dialog shows; without one the attachment does not open. */
	function getOpenUrl(attachment: ChatAttachment): string | undefined {
		if (isImageAttachment(attachment)) {
			return getThumbnailUrl(attachment) || attachment.url;
		}
		if (attachment.type === 'file') return attachment.url;
		if (attachment.type === 'remote-file') return attachment.url;
		if (attachment.type === 'screenshot') return attachment.url;
		return undefined;
	}

	/** MIME type for a non-image attachment (drives the text-preview decision). */
	function getMimeType(attachment: ChatAttachment): string | undefined {
		if (attachment.type === 'file') return attachment.mimeType;
		if (attachment.type === 'screenshot') return attachment.mimeType;
		if (attachment.type === 'remote-file') return attachment.contentType;
		return undefined;
	}

	/**
	 * In-memory blob for a freshly attached file, so the preview can read text
	 * locally without a network round-trip. null for already-sent (remote) ones.
	 */
	function getLocalBlob(attachment: ChatAttachment): Blob | null {
		if (attachment.type === 'file') return attachment.file ?? null;
		if (attachment.type === 'screenshot') return attachment.blob ?? null;
		return null;
	}

	function getKey(attachment: ChatAttachment): string {
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
	function attachmentKey(attachment: ChatAttachment): string {
		return ('key' in attachment && attachment.key) || getKey(attachment);
	}

	function getUploadState(attachment: ChatAttachment): UploadState | undefined {
		if (attachment.type === 'file' || attachment.type === 'screenshot') {
			return attachment.uploadState;
		}
		return undefined;
	}
</script>

<!-- One dialog per attachment, opened by its full-card Attachment.Trigger. -->
{#snippet preview(attachment: ChatAttachment, key: string, filename: string)}
	{@const openUrl = getOpenUrl(attachment)}
	{@const isImage = isImageAttachment(attachment)}
	{@const width = attachment.width}
	{@const height = attachment.height}
	{@const imageDimensions = isImage && width && height ? { width, height } : null}
	{@const titleTruncated = truncatedTitles.has(key)}
	<Dialog.Content
		bind:ref={
			() => previewContents.get(key) ?? null, (element) => previewContents.set(key, element)
		}
		class={imageDimensions ? 'w-(--preview-dialog-width) !max-w-none' : 'sm:max-w-4xl'}
		style={imageDimensions
			? `--preview-ratio: ${imageDimensions.width / imageDimensions.height}; --preview-max-height: min(70dvh, calc(100dvh - 2rem - var(--dialog-inset) * 2 - var(--dialog-gap) - 1em)); --preview-width: min(${imageDimensions.width}px, 512px, 90dvw, calc(100dvw - 2rem - var(--dialog-inset) * 2), calc(var(--preview-max-height) * var(--preview-ratio))); --preview-dialog-width: calc(var(--preview-width) + var(--dialog-inset) * 2);`
			: ''}
		onOpenAutoFocus={(event) => focusDialogClose(key, event)}
	>
		<Dialog.Header class="min-w-0">
			<Tooltip.Root disabled={!titleTruncated}>
				<Tooltip.Trigger disabled={!titleTruncated}>
					{#snippet child({ props })}
						<Dialog.Title
							{...props}
							class="min-w-0 truncate pr-10"
							data-slot="attachment-preview-title"
							{@attach measureTitle(key, filename)}
						>
							{filename}
						</Dialog.Title>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content class="wrap-anywhere">{filename}</Tooltip.Content>
			</Tooltip.Root>
		</Dialog.Header>
		{#if openUrl && !isImage}
			{@const mimeType = getMimeType(attachment)}
			{#if isTextPreviewable(mimeType, filename)}
				<AttachmentTextPreview
					url={openUrl}
					{mimeType}
					{filename}
					blob={getLocalBlob(attachment)}
					loadText={loadText ? () => loadText(attachment) : undefined}
				/>
			{:else}
				<iframe src={openUrl} title={filename} class="h-[70vh] w-full rounded-md"></iframe>
			{/if}
		{:else if openUrl && isImage}
			{#if imageDimensions}
				<div
					class="mx-auto aspect-(--preview-ratio) w-(--preview-width) overflow-hidden rounded-md"
				>
					<img src={openUrl} alt={filename} class="size-full object-contain" />
				</div>
			{:else}
				<img
					src={openUrl}
					alt={filename}
					class="mx-auto max-h-[70vh] max-w-full rounded-md object-contain"
				/>
			{/if}
		{/if}
	</Dialog.Content>
{/snippet}

{#snippet trigger(filename: string)}
	<Dialog.Trigger>
		{#snippet child({ props })}
			<Attachment.Trigger
				{...props}
				aria-label={$t('chat.aria.preview_attachment', { filename })}
			/>
		{/snippet}
	</Dialog.Trigger>
{/snippet}

{#if attachments.length > 0}
	<!-- Sent cards take the user bubble's rounded-3xl radius. Their media stays
	     concentric: the radius minus the default size's 1px border and p-2. -->
	<div
		class="flex gap-2 {readonly
			? `flex-col ${align === 'right' ? 'items-end' : 'items-start'} *:data-[slot=attachment]:rounded-3xl **:data-[slot=attachment-media]:rounded-[calc(var(--radius-3xl)-9px)]`
			: 'flex-row flex-wrap'} {className}"
	>
		{#each attachments as attachment, index (attachmentKey(attachment))}
			{@const key = attachmentKey(attachment)}
			{@const filename = getFilename(attachment)}
			{@const thumbnailUrl = getThumbnailUrl(attachment)}
			{@const uploadState = getUploadState(attachment)}
			{@const state = uploadState ? ATTACHMENT_STATE[uploadState.status] : 'done'}
			<!-- A failed image keeps its local preview, so it would still have an
			     open URL; opening it would suggest the file exists somewhere. -->
			{@const canOpen = state === 'done' && !!getOpenUrl(attachment)}
			{@const canRetry = state === 'error' && !readonly && !!onRetry}
			<Dialog.Root>
				{#if readonly && thumbnailUrl}
					<Attachment.Root orientation="vertical" {state} data-testid="attachment-chip">
						<Attachment.Media variant="image">
							<img src={thumbnailUrl} alt={filename} loading="lazy" decoding="async" />
						</Attachment.Media>
						{#if canOpen}
							{@render trigger(filename)}
						{/if}
					</Attachment.Root>
				{:else}
					<Attachment.Root
						size={readonly ? 'default' : 'sm'}
						{state}
						data-testid="attachment-chip"
						data-upload-failed={state === 'error' ? '' : undefined}
					>
						{#if state === 'uploading'}
							<Attachment.Media>
								<Spinner aria-label={$t('aria.loading')} />
							</Attachment.Media>
						{:else if state === 'error'}
							<Attachment.Media>
								<FileExclamationPointIcon />
							</Attachment.Media>
						{:else if thumbnailUrl}
							<Attachment.Media variant="image">
								<img src={thumbnailUrl} alt={filename} loading="lazy" decoding="async" />
							</Attachment.Media>
						{:else}
							<Attachment.Media>
								<FileTextIcon />
							</Attachment.Media>
						{/if}
						<Attachment.Content>
							<Attachment.Title>{filename}</Attachment.Title>
							{#if uploadState?.status === 'uploading'}
								<Attachment.Description>
									{$t('chat.attachment.uploading', {
										progress: Math.round(uploadState.progress)
									})}
								</Attachment.Description>
							{:else if state === 'error'}
								<Attachment.Description>
									{failureText(uploadState?.error, canRetry)}
								</Attachment.Description>
							{/if}
						</Attachment.Content>
						{#if !readonly}
							<!-- The composer focuses its text field on any click inside it; an
							     action click stops here, so removing a file on a phone does not
							     raise the keyboard. -->
							<Attachment.Actions onclick={(event) => event.stopPropagation()}>
								{#if canRetry}
									<Attachment.Action
										aria-label={$t('chat.aria.retry_attachment', { filename })}
										onclick={() => {
											haptic.trigger('light');
											onRetry?.(index);
										}}
									>
										<RefreshCwIcon />
									</Attachment.Action>
								{/if}
								<Attachment.Action
									aria-label={$t('chat.aria.remove_attachment', { filename })}
									onclick={() => {
										haptic.trigger('light');
										onRemove?.(index);
									}}
								>
									<XIcon />
								</Attachment.Action>
							</Attachment.Actions>
						{/if}
						{#if canOpen}
							{@render trigger(filename)}
						{/if}
					</Attachment.Root>
				{/if}
				{#if canOpen}
					{@render preview(attachment, key, filename)}
				{/if}
			</Dialog.Root>
		{/each}
	</div>
{/if}
