import { describe, expect, it } from 'vitest';
import { GET } from './+server';

describe('GET /api/docs/search.json', () => {
	it('answers 404 while the catalog is unpublished', async () => {
		const response = await GET({} as Parameters<typeof GET>[0]);
		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});
