<script lang="ts">
	import { lockscroll } from '@svelte-put/lockscroll';
	import { snapdom } from '@zumer/snapdom';
	import { setScreenshotEditor } from './screenshot-editor-context.svelte';
	import ScreenshotToolbar from './ScreenshotToolbar.svelte';
	import ScreenshotCanvas from './ScreenshotCanvas.svelte';

	let {
		onCancel
	}: {
		onCancel?: () => void;
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

			console.log('Starting screenshot capture...');
			console.log('Scroll position:', { x: window.scrollX, y: window.scrollY });
			console.log('Viewport size:', { width: window.innerWidth, height: window.innerHeight });

			// Get device pixel ratio (accounts for Retina/HiDPI displays)
			const dpr = window.devicePixelRatio || 1;
			console.log('Device pixel ratio:', dpr);

			// Step 1: Hide editor overlay so it's not captured by SnapDOM
			const editorOverlay = document.querySelector('[data-screenshot-editor]');
			if (editorOverlay instanceof HTMLElement) {
				editorOverlay.style.display = 'none';
			}

			// Step 2: Capture page without Konva overlay
			const result = await snapdom(document.body);
			console.log('SnapDOM capture complete (page only)');

			// Step 3: Convert to PNG image
			const fullPageImage = await result.toPng();
			console.log('Full page image created');

			// Step 4: Load the full page image
			const img = new Image();
			img.src = fullPageImage.src;
			await new Promise((resolve) => {
				img.onload = resolve;
			});
			console.log('Image loaded:', img.width, 'x', img.height);

			// Step 5: Create viewport-sized canvas (scaled for DPR)
			const canvas = document.createElement('canvas');
			canvas.width = window.innerWidth * dpr;
			canvas.height = window.innerHeight * dpr;
			const ctx = canvas.getContext('2d');

			if (!ctx) {
				throw new Error('Failed to get canvas context');
			}

			// Step 6: Crop page to viewport at current scroll position (scale all coordinates by DPR)
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
			console.log('Page viewport cropped to:', canvas.width, 'x', canvas.height, `(DPR: ${dpr})`);

			// Step 7: Export Konva annotations separately
			if (!editorContext.stageRef) {
				throw new Error('Konva stage reference not found');
			}

			const konvaCanvas = editorContext.stageRef.toCanvas({
				pixelRatio: dpr // Match page DPR for consistent quality
			});
			console.log('Konva canvas exported:', konvaCanvas.width, 'x', konvaCanvas.height);

			// Step 8: Composite Konva on top of page canvas
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
			console.log('Konva annotations composited on top');

			// Step 9: Export final composite canvas
			const dataUrl = canvas.toDataURL('image/png', 1.0);
			console.log('Final composite data URL length:', dataUrl.length);

			// Step 10: Download the final composite screenshot
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const filename = `screenshot-${timestamp}.png`;

			const downloadLink = document.createElement('a');
			downloadLink.href = dataUrl;
			downloadLink.download = filename;
			document.body.appendChild(downloadLink);
			downloadLink.click();
			document.body.removeChild(downloadLink);

			console.log('Download triggered:', filename);

			// Close the editor after successful download
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
