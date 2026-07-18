import { test, expect } from '@playwright/test';
import { waitForAuthenticated } from './utils/auth';

// All gotos pin the locale to English: unprefixed paths are redirected by
// src/hooks.server.ts based on Accept-Language (see the precedent in
// e2e/upgrade-checkout-failure.spec.ts), which would break selectors on
// non-English runners.
test.describe('AI Chat - Lazy Warm Thread', () => {
	test('navigating to AI Chat resolves a thread on the chat route', async ({ page }) => {
		await page.goto('/en/app');
		await waitForAuthenticated(page);

		// Click the AI Chat sidebar item
		const aiChatLink = page.getByTestId('sidebar-nav-ai-chat');
		await expect(aiChatLink).toBeVisible();
		await aiChatLink.click();

		// The chat route creates or reuses a warm thread, then canonicalizes the URL.
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 10000 });

		// The chat textarea should be visible (no loading screen)
		await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
	});

	test('sidebar AI Chat href points directly to the chat route', async ({ page }) => {
		await page.goto('/en/app');
		await waitForAuthenticated(page);

		const aiChatAnchor = page.getByTestId('sidebar-nav-ai-chat');
		await expect(aiChatAnchor).toBeVisible();
		await expect(aiChatAnchor).toHaveAttribute('href', '/en/app/ai-chat');
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

	test('returning to AI Chat reuses the same warm thread', async ({ page }) => {
		await page.goto('/en/app');
		await waitForAuthenticated(page);

		const aiChatLink = page.getByTestId('sidebar-nav-ai-chat');
		await aiChatLink.click();
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 10000 });
		const firstThreadId = new URL(page.url()).searchParams.get('thread');
		expect(firstThreadId).toBeTruthy();

		// Leave the chat route entirely so the return click is a genuine navigation
		// off a URL without a thread param — otherwise waitForURL below would match
		// the still-canonical URL before the second resolution even runs.
		await page.goto('/en/app');
		await waitForAuthenticated(page);
		await expect(aiChatLink).toBeVisible();

		await aiChatLink.click();
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 10000 });
		const secondThreadId = new URL(page.url()).searchParams.get('thread');

		// The unused warm thread is reused, not replaced.
		expect(secondThreadId).toBe(firstThreadId);
	});
});
