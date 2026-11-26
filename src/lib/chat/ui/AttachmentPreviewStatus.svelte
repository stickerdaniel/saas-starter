<script lang="ts">
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();

	let { status }: { status: 'loading' | 'error' } = $props();
</script>

{#if status === 'loading'}
	<div
		class="flex h-[70vh] w-full items-center justify-center rounded-md"
		data-testid="attachment-preview-loading"
	>
		<LoaderCircleIcon class="size-6 text-muted-foreground motion-safe:animate-spin" />
		<span class="sr-only">{$t('chat.attachment.preview_loading')}</span>
	</div>
{:else}
	<div
		class="flex h-[70vh] w-full items-center justify-center text-sm text-muted-foreground"
		data-testid="attachment-preview-error"
	>
		{$t('chat.attachment.preview_error')}
	</div>
{/if}
