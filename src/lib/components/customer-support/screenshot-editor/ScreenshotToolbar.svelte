<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import { Square, Pencil, Undo2, Redo2, X, Circle, ArrowRight } from '@lucide/svelte';
	import { screenshotEditorContext } from './screenshot-editor-context.svelte';
	import { cn } from '$lib/utils';
	import { DEFAULT_COLORS } from './types';

	const editor = screenshotEditorContext.get();

	function handleToolClick(tool: typeof editor.currentTool) {
		editor.setTool(tool);
	}
</script>

<div class="fixed top-[1.625rem] left-1/2 z-[110] -translate-x-1/2">
	<div
		class="flex items-center gap-1 rounded-xl border border-border bg-background/95 p-1.5 shadow-lg backdrop-blur-sm"
	>
		<!-- Rectangle Tool -->
		<Button
			variant={editor.currentTool === 'rect' ? 'secondary' : 'ghost'}
			size="icon"
			class="size-9 "
			onclick={() => handleToolClick('rect')}
			title="Rectangle (R)"
		>
			<Square class="size-4" />
		</Button>

		<!-- Circle Tool -->
		<Button
			variant={editor.currentTool === 'circle' ? 'secondary' : 'ghost'}
			size="icon"
			class="size-9 "
			onclick={() => handleToolClick('circle')}
			title="Circle (C)"
		>
			<Circle class="size-4" />
		</Button>

		<!-- Arrow Tool -->
		<Button
			variant={editor.currentTool === 'arrow' ? 'secondary' : 'ghost'}
			size="icon"
			class="size-9 "
			onclick={() => handleToolClick('arrow')}
			title="Arrow (A)"
		>
			<ArrowRight class="size-4" />
		</Button>

		<!-- Pen Tool -->
		<Button
			variant={editor.currentTool === 'pen' ? 'secondary' : 'ghost'}
			size="icon"
			class="size-9 "
			onclick={() => handleToolClick('pen')}
			title="Pen (P)"
		>
			<Pencil class="size-4" />
		</Button>

		<!-- Divider -->
		<div class="mx-1 h-6 w-px bg-border"></div>

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
						title="Change Color"
					></Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="z-[120] w-auto p-2">
				<div class="grid grid-cols-3 gap-1.5">
					{#each DEFAULT_COLORS as { name, value }}
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
		<div class="mx-1 h-6 w-px bg-border"></div>

		<!-- Undo Button -->
		<Button
			variant="ghost"
			size="icon"
			class="size-9 "
			onclick={() => editor.history.undo()}
			disabled={!editor.history.canUndo}
			title="Undo (Ctrl+Z)"
		>
			<Undo2 class="size-4" />
		</Button>

		<!-- Redo Button -->
		<Button
			variant="ghost"
			size="icon"
			class="size-9 "
			onclick={() => editor.history.redo()}
			disabled={!editor.history.canRedo}
			title="Redo (Ctrl+Shift+Z)"
		>
			<Redo2 class="size-4" />
		</Button>

		<!-- Divider -->
		<div class="mx-1 h-6 w-px bg-border"></div>

		<!-- Next Button -->
		<Button
			class="h-9  px-4"
			onclick={editor.handleSave}
			disabled={editor.isSaving || !editor.hasShapes}
		>
			{editor.isSaving ? 'Capturing...' : 'Next'}
		</Button>

		<!-- Close Button -->
		<Button
			variant="ghost"
			size="icon"
			class="size-9 "
			onclick={editor.handleCancel}
			title="Cancel (Esc)"
		>
			<X class="size-4" />
		</Button>
	</div>
</div>
