<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { X, Image as ImageIcon } from '@lucide/svelte';

	let {
		blob,
		onRemove
	}: {
		blob: Blob;
		onRemove?: () => void;
	} = $props();

	// Convert blob to data URL for preview
	let previewUrl = $state<string>('');

	$effect(() => {
		if (blob) {
			const url = URL.createObjectURL(blob);
			previewUrl = url;

			// Cleanup on unmount
			return () => {
				URL.revokeObjectURL(url);
			};
		}
	});

	// Format file size
	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}
</script>

<div
	class="group relative flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3 transition-colors hover:bg-muted"
>
	<!-- Preview Thumbnail -->
	<div
		class="relative size-16 shrink-0 overflow-hidden rounded-md border border-border bg-background"
	>
		{#if previewUrl}
			<img src={previewUrl} alt="Screenshot preview" class="size-full object-cover" />
		{:else}
			<div class="flex size-full items-center justify-center">
				<ImageIcon class="size-6 text-muted-foreground" />
			</div>
		{/if}
	</div>

	<!-- File Info -->
	<div class="flex-1 overflow-hidden">
		<p class="truncate text-sm font-medium">Screenshot</p>
		<p class="text-xs text-muted-foreground">
			{formatFileSize(blob.size)} • PNG
		</p>
	</div>

	<!-- Remove Button -->
	{#if onRemove}
		<Button
			variant="ghost"
			size="icon"
			class="size-8 shrink-0 rounded-md opacity-0 transition-opacity group-hover:opacity-100"
			onclick={onRemove}
			title="Remove screenshot"
		>
			<X class="size-4" />
		</Button>
	{/if}
</div>
