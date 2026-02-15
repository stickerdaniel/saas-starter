import { expect, type Page } from '@playwright/test';

export function getTableQueryParam(page: Page, key: string) {
	return new URL(page.url()).searchParams.get(key);
}

export async function expectTableQueryParams(
	page: Page,
	expected: Record<string, string | RegExp>
) {
	for (const [key, value] of Object.entries(expected)) {
		if (value instanceof RegExp) {
			await expect.poll(() => getTableQueryParam(page, key) ?? '').toMatch(value);
			continue;
		}
		await expect.poll(() => getTableQueryParam(page, key)).toBe(value);
	}
}

export async function expectTableQueryParamMissing(page: Page, key: string) {
	await expect.poll(() => getTableQueryParam(page, key)).toBe(null);
}
