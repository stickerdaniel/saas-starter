<script lang="ts">
	import { Stage, Layer, Line, Rect, Ellipse, Arrow } from 'svelte-konva';
	import { screenshotEditorContext } from './screenshot-editor-context.svelte.ts';
	import type { KonvaEventObject } from 'konva/lib/Node';
	import type { Shape, LineShape, RectShape, CircleShape, ArrowShape } from './types';

	const editor = screenshotEditorContext.get();

	// Get viewport dimensions
	const width = typeof window !== 'undefined' ? window.innerWidth : 1920;
	const height = typeof window !== 'undefined' ? window.innerHeight : 1080;

	// Konva Stage/Layer ref binding (assigned by Svelte bind:this at runtime)
	let stageComponent = $state<ReturnType<typeof Stage> | null>(null);
	let layerComponent = $state<ReturnType<typeof Layer> | null>(null);

	// Bind refs to context when mounted
	$effect(() => {
		if (stageComponent && layerComponent) {
			editor.stageRef = stageComponent.node;
			editor.layerRef = layerComponent.node;
		}
	});

	// ===== Mouse/Touch Event Handlers =====
	function handleMouseDown(e: KonvaEventObject<MouseEvent | TouchEvent>) {
		// Prevent default to avoid selection
		e.evt?.preventDefault();

		const stage = e.target.getStage();
		if (!stage) return;

		const pos = stage.getPointerPosition();
		if (!pos) return;

		// Start drawing (store starting position)
		editor.startDrawing(pos.x, pos.y);

		switch (editor.currentTool) {
			case 'pen': {
				editor.currentShape = editor.createLineShape(pos.x, pos.y);
				break;
			}
			case 'rect': {
				editor.currentShape = editor.createRectShape(pos.x, pos.y);
				break;
			}
			case 'circle': {
				editor.currentShape = editor.createCircleShape(pos.x, pos.y);
				break;
			}
			case 'arrow': {
				editor.currentShape = editor.createArrowShape(pos.x, pos.y);
				break;
			}
		}
	}

	function handleMouseMove(e: KonvaEventObject<MouseEvent | TouchEvent>) {
		if (!editor.isDrawing || !editor.currentShape) return;

		const stage = e.target.getStage();
		if (!stage) return;

		const pos = stage.getPointerPosition();
		if (!pos) return;

		// Modify the current shape directly (no history tracking)
		switch (editor.currentShape.type) {
			case 'pen': {
				const lineShape = editor.currentShape;
				lineShape.points = [...lineShape.points, pos.x, pos.y];
				break;
			}
			case 'rect': {
				const rectShape = editor.currentShape;
				const startX = editor.drawStartPos!.x;
				const startY = editor.drawStartPos!.y;
				// Always calculate from original starting position
				rectShape.x = Math.min(startX, pos.x);
				rectShape.y = Math.min(startY, pos.y);
				rectShape.width = Math.abs(pos.x - startX);
				rectShape.height = Math.abs(pos.y - startY);
				break;
			}
			case 'circle': {
				const circleShape = editor.currentShape;
				const startX = editor.drawStartPos!.x;
				const startY = editor.drawStartPos!.y;
				// Calculate center as midpoint of bounding box
				circleShape.x = (startX + pos.x) / 2;
				circleShape.y = (startY + pos.y) / 2;
				// Calculate radius as half the width/height (creates ellipse in bounding box)
				circleShape.radiusX = Math.abs(pos.x - startX) / 2;
				circleShape.radiusY = Math.abs(pos.y - startY) / 2;
				break;
			}
			case 'arrow': {
				const arrowShape = editor.currentShape;
				const [startX, startY] = arrowShape.points;
				if (startX === undefined || startY === undefined) break;
				arrowShape.points = [startX, startY, pos.x, pos.y];
				break;
			}
		}

		// Force reactivity by creating a new reference
		editor.currentShape = { ...editor.currentShape };
	}

	function handleMouseUp() {
		editor.stopDrawing();
	}

	// ===== Helper Functions for Rendering =====
	function isLineShape(shape: Shape): shape is LineShape {
		return shape.type === 'pen';
	}

	function isRectShape(shape: Shape): shape is RectShape {
		return shape.type === 'rect';
	}

	function isCircleShape(shape: Shape): shape is CircleShape {
		return shape.type === 'circle';
	}

	function isArrowShape(shape: Shape): shape is ArrowShape {
		return shape.type === 'arrow';
	}
</script>

<Stage
	bind:this={stageComponent}
	{width}
	{height}
	divWrapperProps={{ class: '[&_canvas]:cursor-crosshair' }}
	onpointerdown={handleMouseDown}
	onpointermove={handleMouseMove}
	onpointerup={handleMouseUp}
>
	<Layer bind:this={layerComponent}>
		<!-- No screenshot background - page shows through transparent canvas -->
		<!-- Render all shapes -->
		{#each editor.shapes as shape (shape.id)}
			{#if isLineShape(shape)}
				<Line
					points={shape.points}
					stroke={shape.stroke}
					strokeWidth={shape.strokeWidth}
					tension={shape.tension}
					lineCap={shape.lineCap}
					lineJoin={shape.lineJoin}
				/>
			{:else if isRectShape(shape)}
				<Rect
					x={shape.x}
					y={shape.y}
					width={shape.width}
					height={shape.height}
					stroke={shape.stroke}
					strokeWidth={shape.strokeWidth}
					fill={shape.fill}
					cornerRadius={shape.cornerRadius}
					draggable={shape.draggable}
				/>
			{:else if isCircleShape(shape)}
				<Ellipse
					x={shape.x}
					y={shape.y}
					radiusX={shape.radiusX}
					radiusY={shape.radiusY}
					stroke={shape.stroke}
					strokeWidth={shape.strokeWidth}
					fill={shape.fill}
					draggable={shape.draggable}
				/>
			{:else if isArrowShape(shape)}
				<Arrow
					points={shape.points}
					stroke={shape.stroke}
					strokeWidth={shape.strokeWidth}
					fill={shape.stroke}
					pointerLength={shape.pointerLength}
					pointerWidth={shape.pointerWidth}
					draggable={shape.draggable}
				/>
			{/if}
		{/each}

		<!-- Render current shape being drawn (not yet in history) -->
		{#if editor.currentShape}
			{@const shape = editor.currentShape}
			{#if isLineShape(shape)}
				<Line
					points={shape.points}
					stroke={shape.stroke}
					strokeWidth={shape.strokeWidth}
					tension={shape.tension}
					lineCap={shape.lineCap}
					lineJoin={shape.lineJoin}
				/>
			{:else if isRectShape(shape)}
				<Rect
					x={shape.x}
					y={shape.y}
					width={shape.width}
					height={shape.height}
					stroke={shape.stroke}
					strokeWidth={shape.strokeWidth}
					fill={shape.fill}
					cornerRadius={shape.cornerRadius}
					draggable={false}
				/>
			{:else if isCircleShape(shape)}
				<Ellipse
					x={shape.x}
					y={shape.y}
					radiusX={shape.radiusX}
					radiusY={shape.radiusY}
					stroke={shape.stroke}
					strokeWidth={shape.strokeWidth}
					fill={shape.fill}
					draggable={false}
				/>
			{:else if isArrowShape(shape)}
				<Arrow
					points={shape.points}
					stroke={shape.stroke}
					strokeWidth={shape.strokeWidth}
					fill={shape.stroke}
					pointerLength={shape.pointerLength}
					pointerWidth={shape.pointerWidth}
					draggable={false}
				/>
			{/if}
		{/if}
	</Layer>
</Stage>
