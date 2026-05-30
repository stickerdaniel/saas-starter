<script lang="ts">
	import { Streamdown } from 'svelte-streamdown';
	import Code from 'svelte-streamdown/code';
	import Math from 'svelte-streamdown/math';
	import { mode } from 'mode-watcher';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { getTranslate } from '@tolgee/svelte';
	import { tryGetChatUIContext } from './ChatContext.svelte.js';
	import { getPreviewKind, buildCodeMarkdown, capPreviewText } from '../core/attachmentPreview.js';

	const { t } = getTranslate();
	const ctx = tryGetChatUIContext();

	let {
		url,
		mimeType,
		filename,
		blob
	}: {
		/** Remote storage URL (used when there is no local blob). */
		url?: string;
		mimeType?: string;
		filename?: string;
		/** In-memory blob for freshly attached files (no network needed). */
		blob?: Blob | null;
	} = $props();

	const previewKind = $derived(getPreviewKind(mimeType, filename));

	let status = $state<'loading' | 'loaded' | 'error'>('loading');
	let text = $state('');
	let truncated = $state(false);

	// Load the text whenever the source (local blob or remote url) changes.
	// Local blob -> read directly (no network, no CORS). Otherwise fetch the
	// text server-side via the surface's getAttachmentText action (Convex
	// storage URLs are not CORS-readable from the browser). On any failure we
	// fall back to the raw <iframe> below.
	$effect(() => {
		const localBlob = blob;
		const remoteUrl = url;
		const action = ctx?.uploadConfig?.getAttachmentText;
		let cancelled = false;

		status = 'loading';
		text = '';
		truncated = false;

		(async () => {
			try {
				if (localBlob) {
					const capped = capPreviewText(await localBlob.text());
					if (cancelled) return;
					text = capped.text;
					truncated = capped.truncated;
				} else if (remoteUrl && action && ctx?.client) {
					const extraArgs = ctx.uploadConfig?.getGenerateUploadUrlArgs?.() ?? {};
					const res = (await ctx.client.action(action, {
						url: remoteUrl,
						locale: ctx.uploadConfig?.locale,
						...extraArgs
					})) as { text: string; truncated: boolean };
					if (cancelled) return;
					text = res.text;
					truncated = res.truncated;
				} else {
					throw new Error('No text source for attachment preview');
				}
				status = 'loaded';
			} catch {
				if (cancelled) return;
				status = 'error';
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	const renderedMarkdown = $derived.by(() => {
		if (status !== 'loaded') return '';
		if (previewKind.kind === 'markdown') return text;
		if (previewKind.kind === 'code') return buildCodeMarkdown(text, previewKind.lang);
		return '';
	});

	const shikiTheme = $derived(
		mode.current === 'dark' ? 'github-dark-default' : 'github-light-default'
	);

	function isSafeHttpUrl(href: string | undefined | null): boolean {
		return !!href && /^https?:\/\//i.test(href.trim());
	}
</script>

{#if status === 'loading'}
	<div
		class="flex h-[70vh] w-full items-center justify-center rounded-md"
		data-testid="attachment-preview-loading"
	>
		<LoaderCircleIcon class="size-6 text-muted-foreground motion-safe:animate-spin" />
		<span class="sr-only">{$t('chat.attachment.preview_loading')}</span>
	</div>
{:else if status === 'error'}
	{#if url}
		<!-- Fall back to the raw browser view when text could not be loaded. -->
		<iframe src={url} title={filename ?? ''} class="h-[70vh] w-full rounded-md"></iframe>
	{:else}
		<div
			class="flex h-[70vh] w-full items-center justify-center text-sm text-muted-foreground"
			data-testid="attachment-preview-error"
		>
			{$t('chat.attachment.preview_error')}
		</div>
	{/if}
{:else}
	<div class="h-[70vh] w-full overflow-auto rounded-md" data-testid="attachment-preview-content">
		{#if previewKind.kind === 'plaintext'}
			<pre class="text-sm break-words whitespace-pre-wrap">{text}</pre>
		{:else}
			<Streamdown
				content={renderedMarkdown}
				{shikiTheme}
				baseTheme="shadcn"
				renderHtml={false}
				parseIncompleteMarkdown={false}
				allowedImagePrefixes={[]}
				allowedLinkPrefixes={['*']}
				components={{ code: Code, math: Math }}
				class="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
			>
				{#snippet image({ token })}
					<!-- Block all images (incl. relative / protocol-relative) -->
					<span>{token.text}</span>
				{/snippet}
				{#snippet link({ token, children })}
					{#if isSafeHttpUrl(token.href)}
						<a href={token.href} target="_blank" rel="noopener noreferrer nofollow">
							{@render children()}
						</a>
					{:else}
						{@render children()}
					{/if}
				{/snippet}
			</Streamdown>
		{/if}
		{#if truncated}
			<p class="mt-2 text-xs text-muted-foreground">
				{$t('chat.attachment.preview_truncated', { size: '256 KB' })}
			</p>
		{/if}
	</div>
{/if}
