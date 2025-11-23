<script lang="ts">
	import { lockscroll } from '@svelte-put/lockscroll';
	import { snapdom } from '@zumer/snapdom';
	import { getSnapDOMConfig } from '$lib/utils/snapdom-config';
	import { setScreenshotEditor } from './screenshot-editor-context.svelte';
	import ScreenshotToolbar from './ScreenshotToolbar.svelte';
	import ScreenshotCanvas from './ScreenshotCanvas.svelte';

	let {
		onCancel,
		onScreenshotSaved
	}: {
		onCancel?: () => void;
		onScreenshotSaved?: (blob: Blob, filename: string) => void;
	} = $props();

	// Initialize editor context immediately (no screenshot capture needed)
	const editorContext = setScreenshotEditor({
		onSave: handleSave,
		onCancel,
		width: window.innerWidth,
		height: window.innerHeight
	});

	// Capture screenshot and download directly
	async function handleSave() {
		try {
			editorContext.isSaving = true;

			const dpr = window.devicePixelRatio || 1;
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

			// Capture full page without editor overlay
			const result = await snapdom(document.body, {
				...getSnapDOMConfig(),
				exclude: ['[data-screenshot-editor]'],
				excludeMode: 'remove'
			});

			// Convert to PNG image
			const fullPageImage = await result.toPng();

			// Load the full page image
			const img = new Image();
			img.src = fullPageImage.src;
			await new Promise((resolve) => {
				img.onload = resolve;
			});

			// Create viewport-sized canvas (scaled for DPR)
			const canvas = document.createElement('canvas');
			canvas.width = window.innerWidth * dpr;
			canvas.height = window.innerHeight * dpr;
			const ctx = canvas.getContext('2d');

			if (!ctx) {
				throw new Error('Failed to get canvas context');
			}

			// Crop page to viewport at current scroll position (scale all coordinates by DPR)
			ctx.drawImage(
				img,
				window.scrollX * dpr, // Source x (scroll position scaled)
				window.scrollY * dpr, // Source y (scroll position scaled)
				window.innerWidth * dpr, // Source width (viewport size scaled)
				window.innerHeight * dpr, // Source height (viewport size scaled)
				0, // Destination x
				0, // Destination y
				window.innerWidth * dpr, // Destination width (maintain high-res)
				window.innerHeight * dpr // Destination height (maintain high-res)
			);

			// Export Konva annotations
			if (!editorContext.stageRef) {
				throw new Error('Konva stage reference not found');
			}

			const konvaCanvas = editorContext.stageRef.toCanvas({
				pixelRatio: dpr // Match page DPR for consistent quality
			});

			// Composite Konva on top of page canvas
			ctx.drawImage(
				konvaCanvas,
				0, // Source x (Konva is viewport-sized)
				0, // Source y
				konvaCanvas.width, // Source width
				konvaCanvas.height, // Source height
				0, // Destination x
				0, // Destination y
				canvas.width, // Destination width (stretch to match page canvas)
				canvas.height // Destination height
			);

			// Export final composite canvas
			const dataUrl = canvas.toDataURL('image/png', 1.0);

			// Convert dataURL to Blob
			const response = await fetch(dataUrl);
			const blob = await response.blob();
			const filename = `screenshot-${timestamp}.png`;

			// Pass screenshot to parent via callback
			onScreenshotSaved?.(blob, filename);

			// Keep download code for debugging purposes (commented out)
			// const downloadLink = document.createElement('a');
			// downloadLink.href = dataUrl;
			// downloadLink.download = filename;
			// document.body.appendChild(downloadLink);
			// downloadLink.click();
			// document.body.removeChild(downloadLink);

			// Close the editor after successful save
			onCancel?.();
		} catch (error) {
			console.error('Failed to capture screenshot:', error);
			alert('Failed to capture screenshot. Check console for details.');
		} finally {
			editorContext.isSaving = false;
		}
	}

	// Handle keyboard events globally
	function handleKeyDown(e: KeyboardEvent) {
		editorContext.handleKeyDown(e);
	}
</script>

<svelte:window onkeydown={handleKeyDown} />

<!-- Lock body scroll -->
<svelte:body use:lockscroll={true} />

<!-- Transparent overlay over live page -->
<div
	data-screenshot-editor
	class="fixed inset-0 z-[100]"
	role="dialog"
	aria-modal="true"
	aria-label="Screenshot editor"
>
	<ScreenshotToolbar />
	<ScreenshotCanvas />

	<!-- Instructions overlay (bottom center)
	<div
		class="pointer-events-none fixed bottom-4 left-1/2 z-[110] -translate-x-1/2 rounded-lg border border-border bg-background/95 px-4 py-2 shadow-lg backdrop-blur-sm"
	>
		<p class="text-xs text-muted-foreground">
			Press <kbd class="mx-0.5 rounded border border-border bg-muted px-1 py-0.5 font-mono text-xs"
				>Esc</kbd
			> to cancel
		</p>
	</div>
	-->
</div>
