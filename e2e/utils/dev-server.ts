import type { Page } from '@playwright/test';

/** Whether the open page comes from the Vite dev server rather than a build. */
export function servedByDevServer(page: Page): Promise<boolean> {
	return page.evaluate(() =>
		performance
			.getEntriesByType('resource')
			.some((entry) => new URL(entry.name).pathname === '/@vite/client')
	);
}
