import { test, expect } from '@playwright/test';
import { waitForAuthenticated } from './utils/auth';

// All gotos pin the locale to English: unprefixed paths are redirected by
// src/hooks.server.ts based on Accept-Language (see the precedent in
// e2e/upgrade-checkout-failure.spec.ts), which would break selectors on
// non-English runners.
test.describe('AI Chat - Warm Thread', () => {
	test('navigating to AI Chat loads instantly with a thread param', async ({ page }) => {
		await page.goto('/en/app');
		await waitForAuthenticated(page);

		// Click the AI Chat sidebar item
		const aiChatLink = page.getByTestId('sidebar-nav-ai-chat');
		await expect(aiChatLink).toBeVisible();
		await aiChatLink.click();

		// Should navigate to /ai-chat with a ?thread= param (the pre-warmed thread)
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 10000 });

		// The chat textarea should be visible (no loading screen)
		await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
	});

	test('sidebar AI Chat href includes thread param from pre-warm', async ({ page }) => {
		await page.goto('/en/app');
		await waitForAuthenticated(page);

		// The AI Chat link renders as an <a> carrying the testid
		const aiChatAnchor = page.getByTestId('sidebar-nav-ai-chat');
		await expect(aiChatAnchor).toBeVisible();
		await expect(aiChatAnchor).toHaveAttribute('href', /ai-chat\?thread=/, { timeout: 10000 });
	});

	test('direct navigation to /ai-chat without thread param redirects to warm thread', async ({
		page
	}) => {
		await page.goto('/en/app/ai-chat');
		await waitForAuthenticated(page);

		// Should redirect to include ?thread= param
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 15000 });

		// Chat textarea should be visible
		await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
	});

	test('clicking AI Chat when already on warm thread does not navigate away', async ({ page }) => {
		await page.goto('/en/app');
		await waitForAuthenticated(page);

		// Navigate to AI Chat
		const aiChatLink = page.getByTestId('sidebar-nav-ai-chat');
		await aiChatLink.click();
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 10000 });

		// Capture current URL
		const firstUrl = page.url();

		// Click AI Chat again - should stay on the same URL (disableNav)
		await aiChatLink.click();

		// Race a bounded waitForURL against the expected no-nav: if a slow
		// navigation does happen it resolves early and the assertion below
		// fails; if nothing happens it times out harmlessly.
		await page.waitForURL((url) => url.href !== firstUrl, { timeout: 2000 }).catch(() => {});
		expect(page.url()).toBe(firstUrl);
	});
});
