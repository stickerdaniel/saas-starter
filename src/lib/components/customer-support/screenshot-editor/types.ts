/**
 * Screenshot Editor Types
 * Type definitions for the screenshot annotation editor
 */

export type DrawingTool = 'pen' | 'rect' | 'circle' | 'arrow';

/**
 * Base shape properties shared by all shapes
 */
export type BaseShape = {
	id: string;
	type: DrawingTool;
	stroke?: string;
	strokeWidth?: number;
	fill?: string;
	opacity?: number;
	rotation?: number;
	scaleX?: number;
	scaleY?: number;
	draggable?: boolean;
};

/**
 * Line/Pen shape for free drawing
 */
export type LineShape = BaseShape & {
	type: 'pen';
	points: number[]; // [x1, y1, x2, y2, x3, y3, ...]
	tension?: number; // Curve tension (0 = straight, 1 = smooth)
	lineCap?: 'butt' | 'round' | 'square';
	lineJoin?: 'miter' | 'round' | 'bevel';
};

/**
 * Rectangle shape
 */
export type RectShape = BaseShape & {
	type: 'rect';
	x: number;
	y: number;
	width: number;
	height: number;
	cornerRadius?: number;
};

/**
 * Circle/Ellipse shape
 */
export type CircleShape = BaseShape & {
	type: 'circle';
	x: number;
	y: number;
	radiusX: number;
	radiusY: number;
};

/**
 * Arrow shape for pointing/indicating
 */
export type ArrowShape = BaseShape & {
	type: 'arrow';
	points: number[]; // [x1, y1, x2, y2]
	pointerLength?: number;
	pointerWidth?: number;
};

/**
 * Union type of all shape types
 */
export type Shape = LineShape | RectShape | CircleShape | ArrowShape;

/**
 * Color preset for quick selection
 */
export type ColorPreset = {
	name: string;
	value: string;
};

/**
 * Default color palette
 */
export const DEFAULT_COLORS: ColorPreset[] = [
	{ name: 'Red', value: '#ef4444' },
	{ name: 'Yellow', value: '#eab308' },
	{ name: 'Green', value: '#22c55e' },
	{ name: 'Blue', value: '#3b82f6' },
	{ name: 'Purple', value: '#a855f7' },
	{ name: 'Black', value: '#000000' }
];

/**
 * Available stroke widths
 */
export const STROKE_WIDTHS = [2, 3, 4, 6, 8, 12, 16];

/**
 * Default stroke width
 */
export const DEFAULT_STROKE_WIDTH = 8;

/**
 * Default stroke color
 */
export const DEFAULT_STROKE_COLOR = '#ef4444';

/**
 * Default fill (transparent)
 */
export const DEFAULT_FILL = 'transparent';

/**
 * Line drawing settings
 */
export const LINE_TENSION = 0.5;
export const LINE_CAP = 'round' as const;
export const LINE_JOIN = 'round' as const;
