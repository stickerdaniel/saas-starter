// @vitest-environment node

import { createRequire } from 'node:module';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Slider from './slider.svelte';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
	JSDOM: new (html?: string) => { window: { document: Document } };
};

function renderSlider(props: Parameters<typeof render<typeof Slider>>[1]['props']) {
	return new JSDOM(render(Slider, { props }).body).window.document;
}

describe('Slider', () => {
	it('matches the official Vega class contract', () => {
		const host = renderSlider({ type: 'single', value: 25 });

		expect(host.querySelector('[data-slot="slider"]')?.getAttribute('class')).toBe(
			'data-vertical:min-h-40 relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:w-auto data-vertical:flex-col'
		);
		expect(host.querySelector('[data-slot="slider-track"]')?.getAttribute('class')).toBe(
			'bg-muted rounded-full data-horizontal:h-1.5 data-vertical:w-1.5 relative grow overflow-hidden data-horizontal:w-full data-vertical:h-full'
		);
		expect(host.querySelector('[data-slot="slider-range"]')?.getAttribute('class')).toBe(
			'bg-primary absolute select-none data-horizontal:h-full data-vertical:w-full'
		);
		expect(host.querySelector('[data-slot="slider-thumb"]')?.getAttribute('class')).toBe(
			'border-primary ring-ring/50 size-4 rounded-full border bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden block shrink-0 select-none disabled:pointer-events-none disabled:opacity-50'
		);
	});

	it('defaults an omitted single value to the explicit minimum', () => {
		const host = renderSlider({ type: 'single', min: 12, step: 2 });
		const thumb = host.querySelector('[role="slider"]');

		expect(thumb).not.toBeNull();
		expect(thumb?.getAttribute('aria-valuenow')).toBe('12');
	});

	it('defaults an omitted single value to the minimum array step', () => {
		const host = renderSlider({ type: 'single', step: [15, 30, 45] });
		const thumb = host.querySelector('[role="slider"]');

		expect(thumb).not.toBeNull();
		expect(thumb?.getAttribute('aria-valuenow')).toBe('15');
	});

	it('renders an omitted multiple value as an empty thumb collection', () => {
		expect(() => renderSlider({ type: 'multiple' })).not.toThrow();
		expect(renderSlider({ type: 'multiple' }).querySelectorAll('[role="slider"]')).toHaveLength(0);
	});

	it('forwards accessible naming props to the generated slider thumb', () => {
		const host = renderSlider({
			type: 'single',
			value: 25,
			'aria-label': 'Playback position',
			'aria-labelledby': 'slider-label',
			'aria-describedby': 'slider-description',
			'data-testid': 'slider-root'
		});
		const root = host.querySelector('[data-testid="slider-root"]');
		const thumb = host.querySelector('[role="slider"]');

		expect(root).not.toBeNull();
		expect(thumb?.getAttribute('aria-label')).toBe('Playback position');
		expect(thumb?.getAttribute('aria-labelledby')).toBe('slider-label');
		expect(thumb?.getAttribute('aria-describedby')).toBe('slider-description');
	});
});
