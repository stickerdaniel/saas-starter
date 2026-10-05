<script lang="ts">
	import type { Snippet } from 'svelte';
	import { on } from 'svelte/events';
	import { FileUploadContext, fileUploadContext } from './file-upload-context.svelte.ts';
	import { haptic } from '$lib/hooks/use-haptic.svelte.ts';

	type Props = {
		onFilesAdded: (files: File[]) => void;
		children: Snippet;
		multiple?: boolean;
		accept?: string;
		disabled?: boolean;
		/**
		 * Where dragged files are captured: the whole window, or only inside one
		 * element. `null` captures nothing, for an element that is not mounted yet.
		 */
		dropScope?: 'window' | HTMLElement | null;
	};

	let {
		onFilesAdded,
		children,
		multiple = true,
		accept,
		disabled = false,
		dropScope = 'window'
	}: Props = $props();

	const ctx = fileUploadContext.set(new FileUploadContext());
	$effect(() => {
		ctx.multiple = multiple;
		ctx.disabled = disabled;
	});

	$effect(() => {
		const target: EventTarget | null = dropScope === 'window' ? window : dropScope;
		if (!target) return;
		const listeners = [
			on(target, 'dragenter', (e) => handleDragIn(e as DragEvent)),
			on(target, 'dragleave', (e) => handleDragOut(e as DragEvent)),
			on(target, 'dragover', (e) => handleDragOver(e as DragEvent)),
			on(target, 'drop', (e) => handleDrop(e as DragEvent))
		];
		return () => {
			for (const remove of listeners) remove();
		};
	});

	let dragCounter = 0;

	const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

	/**
	 * Whether this drag is ours to handle. Inside an element, a drag without
	 * files (selected text, a link) stays with the browser so it can still be
	 * dropped into the field.
	 */
	function handles(e: DragEvent): boolean {
		if (disabled) return false;
		return dropScope === 'window' || carriesFiles(e);
	}

	/**
	 * A disabled upload still keeps a file dropped in its scope from the browser,
	 * which would otherwise open the file in place of the page and its draft.
	 */
	function refuseFileDrop(e: DragEvent) {
		if (!disabled || !carriesFiles(e)) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
	}

	function handleFiles(files: FileList) {
		haptic.trigger('medium');
		const newFiles = Array.from(files);
		if (multiple) {
			onFilesAdded(newFiles);
		} else {
			onFilesAdded(newFiles.slice(0, 1));
		}
	}

	function handleDrag(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
	}

	function handleDragIn(e: DragEvent) {
		if (!handles(e)) return;
		handleDrag(e);
		dragCounter++;
		if (e.dataTransfer?.items.length) {
			ctx.isDragging = true;
		}
	}

	function handleDragOut(e: DragEvent) {
		if (!handles(e)) return;
		handleDrag(e);
		dragCounter--;
		if (dragCounter === 0) {
			ctx.isDragging = false;
		}
	}

	function handleDragOver(e: DragEvent) {
		if (!handles(e)) return refuseFileDrop(e);
		handleDrag(e);
	}

	function handleDrop(e: DragEvent) {
		if (!handles(e)) return refuseFileDrop(e);
		handleDrag(e);
		ctx.isDragging = false;
		dragCounter = 0;
		if (e.dataTransfer?.files.length) {
			handleFiles(e.dataTransfer.files);
		}
	}

	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files?.length) {
			handleFiles(target.files);
			target.value = '';
		}
	}
</script>

<input
	type="file"
	bind:this={ctx.inputRef}
	onchange={handleFileSelect}
	class="hidden"
	{multiple}
	{accept}
	aria-hidden="true"
	{disabled}
/>

{@render children()}
