<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import type AttachmentTextPreview from '../AttachmentTextPreview.svelte';

	let { filename }: ComponentProps<typeof AttachmentTextPreview> = $props();
</script>

<p data-testid="attachment-text-preview">{filename}</p>
