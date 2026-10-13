import { describe, expect, it } from 'vitest';
import { thumbGeometry, type ThumbListLayout } from './tabs-thumb';

// An untransformed 200x36 list with a 1px border.
const bordered: ThumbListLayout = { width: 200, height: 36, borderLeft: 1, borderTop: 1 };
const listRect = { left: 100, top: 200, width: 200, height: 36 };

describe('thumbGeometry', () => {
	// Rect-based measurement compares two BORDER boxes, while the absolutely
	// positioned thumb is placed against the list's PADDING box. A list given a
	// border (e.g. via its class prop) would otherwise paint the thumb one pixel
	// right of and below its trigger.
	it('drops the list border, so a bordered list places the thumb on its trigger', () => {
		const geometry = thumbGeometry(listRect, bordered, {
			left: 105,
			top: 205,
			width: 90,
			height: 26
		});

		expect(geometry).toEqual({ left: 4, top: 4, width: 90, height: 26 });
	});

	it('leaves a borderless list untouched', () => {
		const geometry = thumbGeometry(
			listRect,
			{ ...bordered, borderLeft: 0, borderTop: 0 },
			{ left: 105, top: 205, width: 90, height: 26 }
		);

		expect(geometry).toEqual({ left: 5, top: 5, width: 90, height: 26 });
	});

	// Measuring rects rather than offsetLeft is what motivated the switch: a
	// trigger in a w-full list lands on a fractional position that whole-pixel
	// offsets would round away.
	it('keeps fractional positions', () => {
		const geometry = thumbGeometry({ left: 10.25, top: 4.5, width: 200, height: 36 }, bordered, {
			left: 74.75,
			top: 5.5,
			width: 64.5,
			height: 26
		});

		expect(geometry.left).toBeCloseTo(63.5, 10);
		expect(geometry.top).toBeCloseTo(0, 10);
		expect(geometry.width).toBeCloseTo(64.5, 10);
	});

	// A dialog opening with a 95% zoom: the first measurement lands mid-animation,
	// where every rect is shrunk. The thumb's styles live inside that same
	// transform, so it needs layout pixels, or the pill stays ~5% small and
	// shifted once the zoom ends.
	it('reports layout pixels while an ancestor transform scales the list', () => {
		const s = 0.95;
		const geometry = thumbGeometry(
			{ left: 100, top: 200, width: 200 * s, height: 36 * s },
			bordered,
			{ left: 100 + 101 * s, top: 200 + 5 * s, width: 94 * s, height: 26 * s }
		);

		expect(geometry.left).toBeCloseTo(100, 10);
		expect(geometry.top).toBeCloseTo(4, 10);
		expect(geometry.width).toBeCloseTo(94, 10);
		expect(geometry.height).toBeCloseTo(26, 10);
	});

	// A hidden list (display: none) reports zero rects and an `auto` computed
	// size; the thumb must not receive Infinity or NaN from a divide by zero.
	it('treats an unmeasurable list as unscaled', () => {
		const geometry = thumbGeometry(
			{ left: 0, top: 0, width: 0, height: 0 },
			{ width: Number.NaN, height: Number.NaN, borderLeft: 0, borderTop: 0 },
			{ left: 0, top: 0, width: 0, height: 0 }
		);

		expect(geometry).toEqual({ left: 0, top: 0, width: 0, height: 0 });
	});
});
