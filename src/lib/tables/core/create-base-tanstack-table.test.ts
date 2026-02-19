import { describe, expect, it } from 'vitest';
import { normalizeBaseTablePageSize } from './create-base-tanstack-table.svelte';

describe('createBaseTanStackTable helpers', () => {
	it('accepts valid page sizes from allowed options', () => {
		expect(
			normalizeBaseTablePageSize({
				value: 20,
				pageSizeOptions: [10, 20, 50],
				fallback: 10
			})
		).toBe(20);
	});

	it('falls back when value is not in allowed options', () => {
		expect(
			normalizeBaseTablePageSize({
				value: 40,
				pageSizeOptions: [10, 20, 50],
				fallback: 10
			})
		).toBe(10);
	});

	it('uses first allowed option when fallback is invalid', () => {
		expect(
			normalizeBaseTablePageSize({
				value: 40,
				pageSizeOptions: [10, 20, 50],
				fallback: 999
			})
		).toBe(10);
	});

	it('supports fallback-only mode without options', () => {
		expect(
			normalizeBaseTablePageSize({
				value: Number.NaN,
				fallback: 25
			})
		).toBe(25);
	});
});
