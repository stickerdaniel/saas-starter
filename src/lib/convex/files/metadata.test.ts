import { describe, expect, it, vi } from 'vitest';
import type { QueryCtx } from '../_generated/server';
import { getFileMetadataByUrls } from './metadata';
import { FILE_ERROR_CODES } from './errors';

describe('getFileMetadataByUrls', () => {
	it('deduplicates URLs before querying metadata', async () => {
		const first = vi.fn().mockResolvedValue({ width: 640, height: 480 });
		const withIndex = vi.fn(() => ({ first }));
		const query = vi.fn(() => ({ withIndex }));
		const ctx = { db: { query } } as unknown as QueryCtx;

		await expect(
			getFileMetadataByUrls(ctx, ['https://example.com/image.png', 'https://example.com/image.png'])
		).resolves.toEqual({
			'https://example.com/image.png': { width: 640, height: 480 }
		});
		expect(query).toHaveBeenCalledTimes(1);
	});

	it('rejects oversized batches before reading the database', async () => {
		const query = vi.fn();
		const ctx = { db: { query } } as unknown as QueryCtx;
		const urls = Array.from({ length: 101 }, (_, index) => `https://example.com/${index}.png`);

		await expect(getFileMetadataByUrls(ctx, urls)).rejects.toMatchObject({
			data: { code: FILE_ERROR_CODES.metadataLimit, maxUrls: 100 }
		});
		expect(query).not.toHaveBeenCalled();
	});
});
