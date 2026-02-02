<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import SquareIcon from '@lucide/svelte/icons/square';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Undo2Icon from '@lucide/svelte/icons/undo-2';
	import Redo2Icon from '@lucide/svelte/icons/redo-2';
	import XIcon from '@lucide/svelte/icons/x';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { screenshotEditorContext } from './screenshot-editor-context.svelte';
	import { cn } from '$lib/utils';
	import { DEFAULT_COLORS } from './types';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
	const editor = screenshotEditorContext.get();

	function handleToolClick(tool: typeof editor.currentTool) {
		editor.setTool(tool);
	}
</script>

<div
	class="fixed top-1/2 right-4 z-[110] -translate-y-1/2 sm:top-[1.625rem] sm:right-auto sm:left-1/2 sm:-translate-x-1/2 sm:translate-y-0"
>
	<div
		class="flex flex-col items-center gap-1 rounded-xl border border-border bg-background/95 p-1.5 shadow-lg backdrop-blur-sm sm:flex-row"
	>
		<!-- Rectangle Tool -->
		<Button
			variant={editor.currentTool === 'rect' ? 'secondary' : 'ghost'}
			size="icon"
			class="size-9 "
			onclick={() => handleToolClick('rect')}
			title={$t('support.screenshot.tool.rectangle')}
		>
			<SquareIcon class="size-4" />
		</Button>

		<!-- Circle Tool -->
		<Button
			variant={editor.currentTool === 'circle' ? 'secondary' : 'ghost'}
			size="icon"
			class="size-9 "
			onclick={() => handleToolClick('circle')}
			title={$t('support.screenshot.tool.circle')}
		>
			<CircleIcon class="size-4" />
		</Button>

		<!-- Arrow Tool -->
		<Button
			variant={editor.currentTool === 'arrow' ? 'secondary' : 'ghost'}
			size="icon"
			class="size-9 "
			onclick={() => handleToolClick('arrow')}
			title={$t('support.screenshot.tool.arrow')}
		>
			<ArrowRightIcon class="size-4" />
		</Button>

		<!-- Pen Tool -->
		<Button
			variant={editor.currentTool === 'pen' ? 'secondary' : 'ghost'}
			size="icon"
			class="size-9 "
			onclick={() => handleToolClick('pen')}
			title={$t('support.screenshot.tool.pen')}
		>
			<PencilIcon class="size-4" />
		</Button>

		<!-- Divider -->
		<div class="my-1 h-px w-6 bg-border sm:mx-1 sm:my-0 sm:h-6 sm:w-px"></div>

		<!-- Color Picker -->
		<Popover.Root>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon"
						class="size-6 rounded-full border-2 border-background ring-2 ring-border"
						style="background-color: {editor.strokeColor};"
						title={$t('support.screenshot.tool.color')}
					></Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="z-[120] w-auto p-2">
				<div class="grid grid-cols-3 gap-1.5">
					{#each DEFAULT_COLORS as { name, value } (value)}
						<Button
							variant="ghost"
							size="icon"
							class={cn(
								'size-6 border-2 transition-all hover:scale-110',
								editor.strokeColor === value
									? 'border-background ring-2 ring-border'
									: 'border-transparent'
							)}
							style="background-color: {value};"
							onclick={() => (editor.strokeColor = value)}
							title={name}
							aria-label={name}
						/>
					{/each}
				</div>
			</Popover.Content>
		</Popover.Root>

		<!-- Divider -->
		<div class="my-1 h-px w-6 bg-border sm:mx-1 sm:my-0 sm:h-6 sm:w-px"></div>

		<!-- Undo Button -->
		<Button
			variant="ghost"
			size="icon"
			class="-order-3 size-9 sm:order-none"
			onclick={() => editor.history.undo()}
			disabled={!editor.history.canUndo}
			title={$t('support.screenshot.action.undo')}
		>
			<Undo2Icon class="size-4" />
		</Button>

		<!-- Redo Button -->
		<Button
			variant="ghost"
			size="icon"
			class="-order-2 size-9 sm:order-none"
			onclick={() => editor.history.redo()}
			disabled={!editor.history.canRedo}
			title={$t('support.screenshot.action.redo')}
		>
			<Redo2Icon class="size-4" />
		</Button>

		<!-- Divider -->
		<div
			class="-order-1 my-1 h-px w-6 bg-border sm:order-none sm:mx-1 sm:my-0 sm:h-6 sm:w-px"
		></div>

		<!-- Next Button - Mobile: Icon -->
		<Button
			size="icon"
			class="size-9 sm:hidden"
			onclick={editor.handleSave}
			disabled={editor.isSaving || !editor.hasShapes}
			title={$t('support.screenshot.next')}
		>
			<CheckIcon class="size-4" />
		</Button>

		<!-- Next Button - Desktop: Text -->
		<Button
			class="hidden h-9 px-4 sm:inline-flex"
			onclick={editor.handleSave}
			disabled={editor.isSaving || !editor.hasShapes}
		>
			{editor.isSaving ? $t('support.screenshot.capturing') : $t('support.screenshot.next')}
		</Button>

		<!-- Close Button -->
		<Button
			variant="ghost"
			size="icon"
			class="-order-4 size-9 sm:order-none"
			onclick={editor.handleCancel}
			title={$t('support.screenshot.action.cancel')}
		>
			<XIcon class="size-4" />
		</Button>
	</div>
</div>
