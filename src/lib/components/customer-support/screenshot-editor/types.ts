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
	{ name: 'Red', value: 'oklch(63.7% 0.237 25.331)' },
	{ name: 'Yellow', value: 'oklch(85.2% 0.199 91.936)' },
	{ name: 'Green', value: 'oklch(72.3% 0.219 149.579)' },
	{ name: 'Blue', value: 'oklch(58.5% 0.233 277.117)' },
	{ name: 'Purple', value: 'oklch(51.8% 0.253 323.949)' },
	{ name: 'Black', value: 'oklch(13% 0.028 261.692)' }
];

/**
 * Default stroke width
 */
export const DEFAULT_STROKE_WIDTH = 10;

/**
 * Default stroke color
 */
export const DEFAULT_STROKE_COLOR = DEFAULT_COLORS[0].value;

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
