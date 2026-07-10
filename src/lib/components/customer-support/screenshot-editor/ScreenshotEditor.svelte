<script lang="ts">
	import { tick } from 'svelte';
	import { lockscroll } from '@svelte-put/lockscroll';
	import { snapdom } from '@zumer/snapdom';
	import { getTranslate, T } from '@tolgee/svelte';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { getSnapDOMConfig } from '$lib/utils/snapdom-config';
	import { processImage } from '$lib/media/process-image';
	import {
		ScreenshotEditorState,
		screenshotEditorContext
	} from './screenshot-editor-context.svelte';
	import ScreenshotToolbar from './ScreenshotToolbar.svelte';
	import { haptic } from '$lib/hooks/use-haptic.svelte';
	import ScreenshotCanvas from './ScreenshotCanvas.svelte';

	const { t } = getTranslate();

	let {
		onCancel,
		onScreenshotSaved,
		onCaptureError
	}: {
		onCancel?: () => void;
		onScreenshotSaved?: (
			blob: Blob,
			filename: string,
			dimensions: { width: number; height: number }
		) => void;
		onCaptureError?: (error: unknown) => void;
	} = $props();

	// Initialize editor context immediately (no screenshot capture needed)
	const editorContext = screenshotEditorContext.set(
		new ScreenshotEditorState({
			onSave: handleSave,
			onCancel: () => onCancel?.(),
			width: window.innerWidth,
			height: window.innerHeight
		})
	);

	// Capture screenshot and pass to callback
	async function handleSave() {
		if (editorContext.isSaving) return; // re-entrancy guard for the pre-paint window
		haptic.trigger('medium');
		editorContext.isSaving = true;
		await tick(); // flush the saving state into the DOM
		// Double rAF guarantees the browser composites the capturing overlay before
		// the synchronous snapdom clone below freezes the main thread.
		await new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
		);
		try {
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

			// Resize + WebP encode on a worker (passthrough fallback if WASM init fails).
			const processed = await processImage(canvas);
			const ext = processed.mimeType === 'image/webp' ? 'webp' : 'png';
			const filename = `screenshot-${timestamp}.${ext}`;
			const dimensions = { width: processed.width, height: processed.height };

			// Pass screenshot to parent via callback
			onScreenshotSaved?.(processed.blob, filename, dimensions);

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
			// Hand the failure to the parent, which tears down this overlay and
			// surfaces a recoverable error dialog (retry / contact support).
			onCaptureError?.(error);
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
	aria-label={$t('support.screenshot.aria_label')}
>
	<ScreenshotToolbar />
	<ScreenshotCanvas />

	{#if editorContext.isSaving}
		<!-- Capturing feedback. Kept inside [data-screenshot-editor] so snapdom's
		     excludeMode:'remove' strips it from the capture with the rest of the
		     editor chrome. z-index sits above the toolbar (z-[110]) and canvas. -->
		<div
			class="fixed inset-0 z-[120] flex items-center justify-center bg-background/95 backdrop-blur-sm"
		>
			<div
				class="flex items-center gap-3 rounded-xl bg-background px-5 py-3 shadow-lg ring-1 ring-foreground/10"
			>
				<LoaderCircleIcon class="size-5 text-muted-foreground motion-safe:animate-spin" />
				<span class="text-sm font-medium"><T keyName="support.screenshot.capturing" /></span>
			</div>
		</div>
	{/if}

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
