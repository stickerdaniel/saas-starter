/** The part of a DOMRect the thumb measurement needs. */
export type ThumbRect = Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>;

/**
 * The tabs list's untransformed layout box: its border-box size (the computed
 * `width`/`height` under `box-sizing: border-box`) and its own border widths,
 * as `clientLeft` / `clientTop` report them.
 */
export interface ThumbListLayout {
	width: number;
	height: number;
	borderLeft: number;
	borderTop: number;
}

/**
 * Where, and how large, the active-pill thumb has to be inside its tabs list,
 * in the list's own layout pixels.
 *
 * Both boxes are measured with `getBoundingClientRect()`, which keeps the
 * fractional trigger widths that `offsetLeft`/`offsetWidth` round to whole
 * pixels. Rects come back in viewport pixels, after every ancestor transform,
 * while the thumb's inline styles are layout pixels inside that same transform.
 * A list inside a dialog that opens with a zoom measures at ~95% and would keep
 * a pill ~5% too small once the zoom ends, so the rect differences are divided
 * by the list's rendered-to-layout scale first.
 *
 * A rect is also the BORDER box, but the thumb is absolutely positioned, so its
 * containing block is the list's PADDING box, one border-width inside. The list
 * border (in layout pixels) comes off both axes after unscaling.
 */
export function thumbGeometry(
	listRect: ThumbRect,
	list: ThumbListLayout,
	triggerRect: ThumbRect
): { left: number; top: number; width: number; height: number } {
	const scaleX = scale(listRect.width, list.width);
	const scaleY = scale(listRect.height, list.height);
	return {
		left: (triggerRect.left - listRect.left) / scaleX - list.borderLeft,
		top: (triggerRect.top - listRect.top) / scaleY - list.borderTop,
		width: triggerRect.width / scaleX,
		height: triggerRect.height / scaleY
	};
}

// A collapsed or unmeasurable list has no meaningful scale; treat it as 1.
function scale(rendered: number, layout: number): number {
	return rendered > 0 && layout > 0 ? rendered / layout : 1;
}
