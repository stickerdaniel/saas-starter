<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import ScreenshotSubmitButton from '#lib/components/ui/owned/screenshot-submit-button.svelte';
	import { ColorSelector } from '#lib/components/ui/color-selector/index.js';
	import SquareIcon from '@lucide/svelte/icons/square';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import Redo2Icon from '@lucide/svelte/icons/redo-2';
	import XIcon from '@lucide/svelte/icons/x';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import { screenshotEditorContext } from './screenshot-editor-context.svelte.ts';
	import { DEFAULT_COLORS } from './types';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
	const editor = screenshotEditorContext.get();

	const colorSwatches = DEFAULT_COLORS.map((c) => c.value);
	const colorLabels = $derived(
		Object.fromEntries(DEFAULT_COLORS.map((c) => [c.value, $t(c.nameKey)]))
	);

	function handleToolClick(tool: typeof editor.currentTool) {
		editor.setTool(tool);
	}

	function keepSelectedColorVisible(palette: HTMLDivElement) {
		function revealSelectedColor() {
			const selected = palette.querySelector<HTMLElement>('[aria-checked="true"]');
			if (!selected || !palette.clientHeight) return;

			const bounds = palette.getBoundingClientRect();
			const swatch = selected.getBoundingClientRect();
			const style = getComputedStyle(palette);
			const top = bounds.top + parseFloat(style.scrollPaddingTop);
			const bottom = bounds.bottom - parseFloat(style.scrollPaddingBottom);

			// Scroll only the palette, leaving document position and focus untouched.
			if (swatch.top < top) palette.scrollTop += swatch.top - top;
			else if (swatch.bottom > bottom) palette.scrollTop += swatch.bottom - bottom;
		}

		$effect(() => {
			if (editor.strokeColor) revealSelectedColor();
		});

		const observer = new ResizeObserver(revealSelectedColor);
		observer.observe(palette);
		return () => observer.disconnect();
	}
</script>

<div
	class="fixed top-1/2 right-4 z-110 -translate-y-1/2 sm:top-6.5 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 sm:translate-y-0"
>
	<div
		class="box-content flex max-h-dvh flex-col items-center gap-1 rounded-xl border border-border bg-background/95 p-1.5 shadow-lg backdrop-blur-sm sm:max-h-none sm:flex-row"
	>
		<!-- Rectangle Tool -->
		<Button
			variant={editor.currentTool === 'rect' ? 'secondary' : 'ghost'}
			size="icon"
			onclick={() => handleToolClick('rect')}
			aria-label={$t('support.screenshot.tool.rectangle')}
		>
			<SquareIcon class="size-4" />
		</Button>

		<!-- Circle Tool -->
		<Button
			variant={editor.currentTool === 'circle' ? 'secondary' : 'ghost'}
			size="icon"
			onclick={() => handleToolClick('circle')}
			aria-label={$t('support.screenshot.tool.circle')}
		>
			<CircleIcon class="size-4" />
		</Button>

		<!-- Arrow Tool -->
		<Button
			variant={editor.currentTool === 'arrow' ? 'secondary' : 'ghost'}
			size="icon"
			onclick={() => handleToolClick('arrow')}
			aria-label={$t('support.screenshot.tool.arrow')}
		>
			<ArrowRightIcon class="size-4" />
		</Button>

		<!-- Pen Tool -->
		<Button
			variant={editor.currentTool === 'pen' ? 'secondary' : 'ghost'}
			size="icon"
			onclick={() => handleToolClick('pen')}
			aria-label={$t('support.screenshot.tool.pen')}
		>
			<PencilIcon class="size-4" />
		</Button>

		<!-- Divider -->
		<div class="my-1 h-px w-6 shrink-0 bg-border sm:mx-1 sm:my-0 sm:h-6 sm:w-px"></div>

		<!-- Color Selector -->
		<div
			class="-my-1 no-scrollbar min-h-0 shrink scroll-py-1 overflow-y-auto overscroll-contain py-1 sm:contents"
			{@attach keepSelectedColorVisible}
		>
			<ColorSelector
				colors={colorSwatches}
				size="lg"
				bind:value={editor.strokeColor}
				getColorLabel={(color) => colorLabels[color] ?? color}
				aria-label={$t('support.screenshot.tool.color')}
				class="flex-col items-center px-1 sm:flex-row sm:px-0"
				data-testid="screenshot-color-selector"
			/>
		</div>

		<!-- Divider -->
		<div class="my-1 h-px w-6 shrink-0 bg-border sm:mx-1 sm:my-0 sm:h-6 sm:w-px"></div>

		<!-- Undo Button -->
		<Button
			variant="ghost"
			size="icon"
			class="-order-3 sm:order-none"
			onclick={() => editor.history.undo()}
			disabled={!editor.history.canUndo}
			aria-label={$t('support.screenshot.action.undo')}
		>
			<Undo2Icon class="size-4" />
		</Button>

		<!-- Redo Button -->
		<Button
			variant="ghost"
			size="icon"
			class="-order-2 sm:order-none"
			onclick={() => editor.history.redo()}
			disabled={!editor.history.canRedo}
			aria-label={$t('support.screenshot.action.redo')}
		>
			<Redo2Icon class="size-4" />
		</Button>

		<!-- Divider -->
		<div
			class="-order-1 my-1 h-px w-6 shrink-0 bg-border sm:order-none sm:mx-1 sm:my-0 sm:h-6 sm:w-px"
		></div>

		<!-- Next Button - Mobile: Icon -->
		<Button
			size="icon"
			class="sm:hidden"
			onclick={editor.handleSave}
			disabled={editor.isSaving || !editor.hasShapes}
			aria-label={editor.isSaving
				? $t('support.screenshot.capturing')
				: $t('support.screenshot.next')}
		>
			{#if editor.isSaving}
				<LoaderCircleIcon class="size-4 motion-safe:animate-spin" />
			{:else}
				<CheckIcon class="size-4" />
			{/if}
		</Button>

		<!-- Next Button - Desktop: Text -->
		<ScreenshotSubmitButton
			onclick={editor.handleSave}
			disabled={editor.isSaving || !editor.hasShapes}
		>
			{editor.isSaving ? $t('support.screenshot.capturing') : $t('support.screenshot.next')}
		</ScreenshotSubmitButton>

		<!-- Close Button -->
		<Button
			variant="ghost"
			size="icon"
			class="-order-4 sm:order-none"
			onclick={editor.handleCancel}
			aria-label={$t('support.screenshot.action.cancel')}
		>
			<XIcon class="size-4" />
		</Button>
	</div>
</div>
