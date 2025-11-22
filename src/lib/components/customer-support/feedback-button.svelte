<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { MessageSquare, ChevronDown } from '@lucide/svelte';
	import FeedbackWidget from './feedback-widget.svelte';
	import { on } from 'svelte/events';
	import type { UploadState } from './attachments.svelte';

	let {
		isOpen = $bindable(false),
		isScreenshotMode = $bindable(false),
		screenshots = [],
		onClearScreenshot,
		attachedFiles = [],
		onFilesAdded,
		onRemoveFile
	}: {
		isOpen?: boolean;
		isScreenshotMode?: boolean;
		screenshots?: Array<{ blob: Blob; filename: string; uploadState: UploadState }>;
		onClearScreenshot?: (index: number) => void;
		attachedFiles?: Array<{ file: File; preview?: string; uploadState: UploadState }>;
		onFilesAdded?: (files: File[]) => void;
		onRemoveFile?: (index: number) => void;
	} = $props();

	function toggleOpen() {
		isOpen = !isOpen;
	}

	$effect(() => {
		if (!isOpen) return;

		return on(window, 'keydown', (event) => {
			if (event.key === 'Escape') {
				isOpen = false;
			}
		});
	});
</script>

{#if !isScreenshotMode}
	<div class="fixed right-5 bottom-5 z-200 flex flex-col items-end justify-end gap-3">
		{#if isOpen}
			<FeedbackWidget
				bind:isScreenshotMode
				{screenshots}
				{onClearScreenshot}
				{attachedFiles}
				{onFilesAdded}
				{onRemoveFile}
			/>
		{/if}
		<Button
			variant="default"
			size="icon"
			class="h-12 w-12 rounded-full transition-colors transition-transform duration-300 ease-in-out hover:scale-110 hover:bg-primary"
			onclick={toggleOpen}
		>
			<div class="relative size-6">
				<ChevronDown
					class="absolute inset-0 size-6 transition-all duration-200 ease-out {isOpen
						? 'scale-100 opacity-100'
						: 'scale-0 opacity-0'}"
				/>
				<div class="-scale-x-100">
					<MessageSquare
						class="absolute inset-0 size-6 fill-current transition-all duration-200 ease-in-out {isOpen
							? 'scale-0 opacity-0'
							: 'scale-100 opacity-100'}"
					/>
				</div>
			</div>
		</Button>
	</div>
{/if}
