import { test, expect } from '@playwright/test';
import { waitForAuthenticated } from './utils/auth';

// Guards the sidebar_state cookie round-trip: the provider writes the cookie on
// toggle, hooks.server.ts reads it into locals, and the root layout forwards it
// to Sidebar.Provider so SSR paints the correct state. Before the read side
// existed the shell always came back expanded and reflowed full-width on reload.
test.describe('Authenticated sidebar collapse persistence', () => {
	test('collapsed state survives a reload', async ({ page }) => {
		await page.goto('/app');
		await waitForAuthenticated(page);

		// Desktop sidebar root carries data-state; the mobile sheet variant does not.
		const sidebar = page.locator('[data-slot="sidebar"][data-state]');
		const trigger = page.locator('[data-sidebar="trigger"]');

		// Default is expanded.
		await expect(sidebar).toHaveAttribute('data-state', 'expanded');

		// Collapse it and confirm the choice was persisted to the cookie the
		// server reads on the next request.
		await trigger.click();
		await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
		const cookie = (await page.context().cookies()).find((c) => c.name === 'sidebar_state');
		expect(cookie?.value).toBe('false');

		// Reload: the server reads the cookie and renders the collapsed shell, so
		// the first paint is already collapsed (no client-side correction flash).
		await page.reload();
		await expect(sidebar).toHaveAttribute('data-state', 'collapsed');

		// Round-trips the other way too: re-expand, reload, still expanded.
		await waitForAuthenticated(page);
		await trigger.click();
		await expect(sidebar).toHaveAttribute('data-state', 'expanded');
		await page.reload();
		await expect(sidebar).toHaveAttribute('data-state', 'expanded');
	});
});
