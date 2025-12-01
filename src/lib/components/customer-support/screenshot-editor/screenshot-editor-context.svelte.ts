/**
 * Screenshot Editor Context
 * State management for the screenshot annotation editor using Svelte 5 runes and Runed
 */

import { getContext, setContext } from 'svelte';
import { StateHistory } from 'runed';
import { preCache } from '@zumer/snapdom';
import { getPreCacheConfig } from '$lib/utils/snapdom-config';
import type { Shape, DrawingTool, LineShape, RectShape, CircleShape, ArrowShape } from './types';
import {
	DEFAULT_STROKE_COLOR,
	DEFAULT_STROKE_WIDTH,
	DEFAULT_FILL,
	LINE_TENSION,
	LINE_CAP,
	LINE_JOIN
} from './types';

export type ScreenshotEditorProps = {
	/**
	 * Callback when user saves the annotated screenshot (downloads directly)
	 */
	onSave?: () => void | Promise<void>;

	/**
	 * Callback when user cancels the editor
	 */
	onCancel?: () => void;

	/**
	 * Initial viewport dimensions
	 */
	width?: number;
	height?: number;
};

export class ScreenshotEditorState {
	readonly props: ScreenshotEditorProps;

	// ===== Core Drawing State =====
	shapes = $state<Shape[]>([]);
	currentTool = $state<DrawingTool>('pen');

	// ===== Styling State =====
	strokeColor = $state(DEFAULT_STROKE_COLOR);
	strokeWidth = $state(DEFAULT_STROKE_WIDTH);
	fillColor = $state(DEFAULT_FILL);

	// ===== Drawing Interaction State =====
	isDrawing = $state(false);
	currentShape = $state<Shape | null>(null);
	drawStartPos = $state<{ x: number; y: number } | null>(null);

	// ===== Selection/Transform State =====
	selectedShapeIds = $state<string[]>([]);

	// ===== Canvas State =====
	stageRef = $state<any>(null); // Konva.Stage reference
	layerRef = $state<any>(null); // Konva.Layer reference

	// ===== Loading State =====
	isSaving = $state(false);
	hasPreCached = $state(false);

	// ===== Undo/Redo using Runed StateHistory =====
	history: StateHistory<Shape[]>;

	// ===== Derived State =====
	canDelete = $derived(this.selectedShapeIds.length > 0);
	hasShapes = $derived(this.shapes.length > 0);

	constructor(props: ScreenshotEditorProps) {
		this.props = props;

		// Initialize StateHistory for undo/redo
		this.history = new StateHistory(
			() => this.shapes,
			(newShapes) => {
				this.shapes = newShapes;
			}
		);
	}

	// ===== Shape Management =====
	addShape(shape: Shape) {
		this.shapes = [...this.shapes, shape];
	}

	updateShape(id: string, updates: Partial<Shape>) {
		this.shapes = this.shapes.map((s) => (s.id === id ? ({ ...s, ...updates } as Shape) : s));
	}

	deleteShape(id: string) {
		this.shapes = this.shapes.filter((s) => s.id !== id);
		this.selectedShapeIds = this.selectedShapeIds.filter((sid) => sid !== id);
	}

	deleteSelectedShapes() {
		this.shapes = this.shapes.filter((s) => !this.selectedShapeIds.includes(s.id));
		this.selectedShapeIds = [];
	}

	clearAllShapes() {
		this.shapes = [];
		this.selectedShapeIds = [];
		this.history.clear();
	}

	// ===== Tool Management =====
	setTool(tool: DrawingTool) {
		this.currentTool = tool;
		// Clear selection when switching tools
		this.selectedShapeIds = [];
	}

	// ===== Selection Management =====
	selectShape(id: string, multiSelect: boolean = false) {
		if (multiSelect) {
			const isSelected = this.selectedShapeIds.includes(id);
			if (isSelected) {
				this.selectedShapeIds = this.selectedShapeIds.filter((sid) => sid !== id);
			} else {
				this.selectedShapeIds = [...this.selectedShapeIds, id];
			}
		} else {
			this.selectedShapeIds = [id];
		}
	}

	clearSelection() {
		this.selectedShapeIds = [];
	}

	// ===== Drawing Helpers =====
	startDrawing(x: number, y: number) {
		this.isDrawing = true;
		this.drawStartPos = { x, y };

		// Preload resources on first drawing action (fire-and-forget, runs in background)
		if (!this.hasPreCached) {
			this.hasPreCached = true;
			void preCache(document.body, getPreCacheConfig()).catch((error) => {
				console.warn('Failed to preload screenshot resources:', error);
			});
		}
	}

	stopDrawing() {
		this.isDrawing = false;
		// Add the completed shape to the tracked shapes array (creates one history entry)
		if (this.currentShape) {
			this.shapes = [...this.shapes, this.currentShape];
		}
		this.currentShape = null;
		this.drawStartPos = null;
	}

	/**
	 * Create a new line shape for pen tool
	 */
	createLineShape(x: number, y: number): LineShape {
		return {
			id: crypto.randomUUID(),
			type: 'pen',
			points: [x, y],
			stroke: this.strokeColor,
			strokeWidth: this.strokeWidth,
			tension: LINE_TENSION,
			lineCap: LINE_CAP,
			lineJoin: LINE_JOIN
		};
	}

	/**
	 * Create a new rectangle shape
	 */
	createRectShape(x: number, y: number): RectShape {
		return {
			id: crypto.randomUUID(),
			type: 'rect',
			x,
			y,
			width: 0,
			height: 0,
			stroke: this.strokeColor,
			strokeWidth: this.strokeWidth,
			fill: this.fillColor,
			draggable: false
		};
	}

	/**
	 * Create a new circle shape
	 */
	createCircleShape(x: number, y: number): CircleShape {
		return {
			id: crypto.randomUUID(),
			type: 'circle',
			x,
			y,
			radiusX: 0,
			radiusY: 0,
			stroke: this.strokeColor,
			strokeWidth: this.strokeWidth,
			fill: this.fillColor,
			draggable: false
		};
	}

	/**
	 * Create a new arrow shape
	 */
	createArrowShape(x: number, y: number): ArrowShape {
		return {
			id: crypto.randomUUID(),
			type: 'arrow',
			points: [x, y, x, y],
			stroke: this.strokeColor,
			strokeWidth: this.strokeWidth,
			pointerLength: 15,
			pointerWidth: 15,
			draggable: false
		};
	}

	// ===== Actions =====
	handleSave = () => {
		// Clear selection before capturing
		this.clearSelection();
		// The actual capture is handled by ScreenshotEditor.svelte
		void this.props.onSave?.();
	};

	handleCancel = () => {
		this.props.onCancel?.();
	};

	// ===== Keyboard Shortcuts =====
	handleKeyDown = (e: KeyboardEvent) => {
		// Prevent shortcuts if typing in input
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
			return;
		}

		// Undo: Ctrl+Z / Cmd+Z
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			this.history.undo();
			return;
		}

		// Redo: Ctrl+Shift+Z / Cmd+Shift+Z
		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
			e.preventDefault();
			this.history.redo();
			return;
		}

		// Delete: Delete / Backspace
		if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedShapeIds.length > 0) {
			e.preventDefault();
			this.deleteSelectedShapes();
			return;
		}

		// Escape: Clear selection or cancel
		if (e.key === 'Escape') {
			e.preventDefault();
			if (this.selectedShapeIds.length > 0) {
				this.clearSelection();
			} else {
				this.handleCancel();
			}
			return;
		}

		// Tool shortcuts (lowercase)
		const toolShortcuts: Record<string, DrawingTool> = {
			p: 'pen',
			r: 'rect',
			c: 'circle',
			a: 'arrow'
		};

		if (toolShortcuts[e.key.toLowerCase()]) {
			e.preventDefault();
			this.setTool(toolShortcuts[e.key.toLowerCase()]);
		}
	};
}

// ===== Context Functions =====
const SYMBOL_KEY = 'screenshot-editor';

export function setScreenshotEditor(props: ScreenshotEditorProps): ScreenshotEditorState {
	return setContext(Symbol.for(SYMBOL_KEY), new ScreenshotEditorState(props));
}

export function useScreenshotEditor(): ScreenshotEditorState {
	const context = getContext<ScreenshotEditorState>(Symbol.for(SYMBOL_KEY));

	if (!context) {
		throw new Error('Screenshot editor components must be used within ScreenshotEditor');
	}

	return context;
}
