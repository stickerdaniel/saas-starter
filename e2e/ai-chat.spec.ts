import { test, expect } from '@playwright/test';
import { waitForAuthenticated } from './utils/auth';

test.describe('AI Chat - Warm Thread', () => {
	test('navigating to AI Chat loads instantly with a thread param', async ({ page }) => {
		await page.goto('/app');
		await waitForAuthenticated(page);

		// Click the AI Chat sidebar item
		const aiChatLink = page.locator('[data-sidebar="menu-button"]', {
			has: page.locator('span', { hasText: /AI Chat/i })
		});
		await expect(aiChatLink).toBeVisible();
		await aiChatLink.click();

		// Should navigate to /ai-chat with a ?thread= param (the pre-warmed thread)
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 10000 });

		// The chat textarea should be visible (no loading screen)
		await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
	});

	test('sidebar AI Chat href includes thread param from pre-warm', async ({ page }) => {
		await page.goto('/app');
		await waitForAuthenticated(page);

		// The AI Chat link renders as an <a> with data-sidebar="menu-button" (via child snippet)
		const aiChatAnchor = page.locator('a[data-sidebar="menu-button"]', {
			has: page.locator('span', { hasText: /AI Chat/i })
		});
		await expect(aiChatAnchor).toBeVisible();
		await expect(aiChatAnchor).toHaveAttribute('href', /ai-chat\?thread=/, { timeout: 10000 });
	});

	test('direct navigation to /ai-chat without thread param redirects to warm thread', async ({
		page
	}) => {
		await page.goto('/app/ai-chat');
		await waitForAuthenticated(page);

		// Should redirect to include ?thread= param
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 15000 });

		// Chat textarea should be visible
		await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
	});

	test('clicking AI Chat when already on warm thread does not navigate away', async ({ page }) => {
		await page.goto('/app');
		await waitForAuthenticated(page);

		// Navigate to AI Chat
		const aiChatLink = page.locator('[data-sidebar="menu-button"]', {
			has: page.locator('span', { hasText: /AI Chat/i })
		});
		await aiChatLink.click();
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 10000 });

		// Capture current URL
		const firstUrl = page.url();

		// Click AI Chat again - should stay on the same URL (disableNav)
		await aiChatLink.click();

		// Small wait to ensure no navigation happens
		await page.waitForTimeout(500);
		expect(page.url()).toBe(firstUrl);
	});
});
