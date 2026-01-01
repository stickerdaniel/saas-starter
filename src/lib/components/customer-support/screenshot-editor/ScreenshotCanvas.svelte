<script lang="ts">
	import { Stage, Layer, Line, Rect, Circle, Ellipse, Arrow, Group } from 'svelte-konva';
	import { screenshotEditorContext } from './screenshot-editor-context.svelte';
	import type { LineShape, RectShape, CircleShape, ArrowShape } from './types';

	const editor = screenshotEditorContext.get();

	// Get viewport dimensions
	const width = typeof window !== 'undefined' ? window.innerWidth : 1920;
	const height = typeof window !== 'undefined' ? window.innerHeight : 1080;

	// Konva Stage/Layer ref binding
	let stageComponent: any;
	let layerComponent: any;

	// Bind refs to context when mounted
	$effect(() => {
		if (stageComponent && layerComponent) {
			editor.stageRef = stageComponent.node;
			editor.layerRef = layerComponent.node;
		}
	});

	// ===== Mouse/Touch Event Handlers =====
	function handleMouseDown(e: any) {
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

	function handleMouseMove(e: any) {
		if (!editor.isDrawing || !editor.currentShape) return;

		const stage = e.target.getStage();
		if (!stage) return;

		const pos = stage.getPointerPosition();
		if (!pos) return;

		// Modify the current shape directly (no history tracking)
		switch (editor.currentShape.type) {
			case 'pen': {
				const lineShape = editor.currentShape as LineShape;
				lineShape.points = [...lineShape.points, pos.x, pos.y];
				break;
			}
			case 'rect': {
				const rectShape = editor.currentShape as RectShape;
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
				const circleShape = editor.currentShape as CircleShape;
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
				const arrowShape = editor.currentShape as ArrowShape;
				arrowShape.points = [arrowShape.points[0], arrowShape.points[1], pos.x, pos.y];
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
	function isLineShape(shape: any): shape is LineShape {
		return shape.type === 'pen';
	}

	function isRectShape(shape: any): shape is RectShape {
		return shape.type === 'rect';
	}

	function isCircleShape(shape: any): shape is CircleShape {
		return shape.type === 'circle';
	}

	function isArrowShape(shape: any): shape is ArrowShape {
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
