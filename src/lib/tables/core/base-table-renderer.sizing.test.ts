import { describe, expect, it } from 'vitest';
import { buildColumnStyle, getColumnStyleArgs } from './layout-presets';

describe('base table renderer sizing policy', () => {
	it('locks fixed columns to width/min/max', () => {
		const style = buildColumnStyle(
			getColumnStyleArgs({
				size: 40,
				minSize: 40,
				maxSize: 40,
				meta: { sizingMode: 'fixed' }
			})
		);

		expect(style).toBe('width: 40px; min-width: 40px; max-width: 40px;');
	});

	it('keeps fluid columns out of explicit width distribution', () => {
		const style = buildColumnStyle(
			getColumnStyleArgs({
				size: 220,
				minSize: 140,
				maxSize: 320
			})
		);

		expect(style).toBe('min-width: 140px;');
		expect(style).not.toContain('width: 220px;');
		expect(style).not.toContain('max-width: 320px;');
	});
});
