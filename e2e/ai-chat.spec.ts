import { test, expect } from '@playwright/test';
import { waitForAuthenticated } from './utils/auth';

// All gotos pin the locale to English: unprefixed paths are redirected by
// src/hooks.server.ts based on Accept-Language (see the precedent in
// e2e/upgrade-checkout-failure.spec.ts), which would break selectors on
// non-English runners.
test.describe('AI Chat - Warm Thread', () => {
	test('sidebar navigation opens the prewarmed composer without a loading state', async ({
		page
	}) => {
		await page.goto('/en/app');
		await waitForAuthenticated(page);

		const aiChatLink = page.getByTestId('sidebar-nav-ai-chat');
		await expect(aiChatLink).toBeVisible();
		await expect(aiChatLink).toHaveAttribute('href', /\/en\/app\/ai-chat\?thread=.+/);

		await aiChatLink.click();
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 10000 });

		await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
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
		await expect(aiChatLink).toHaveAttribute('href', /\/en\/app\/ai-chat\?thread=.+/);
		const firstHref = await aiChatLink.getAttribute('href');
		expect(firstHref).toBeTruthy();
		const firstThreadId = new URL(firstHref!, page.url()).searchParams.get('thread');
		await aiChatLink.click();
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 10000 });
		expect(firstThreadId).toBeTruthy();

		// Leave the chat route entirely so the return click is a genuine navigation
		// off a URL without a thread param — otherwise waitForURL below would match
		// the still-canonical URL before the second resolution even runs.
		await page.goto('/en/app');
		await waitForAuthenticated(page);
		await expect(aiChatLink).toBeVisible();
		await expect(aiChatLink).toHaveAttribute('href', new RegExp(`\\?thread=${firstThreadId}$`));

		await aiChatLink.click();
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 10000 });
		const secondThreadId = new URL(page.url()).searchParams.get('thread');

		// The unused warm thread is reused, not replaced.
		expect(secondThreadId).toBe(firstThreadId);
	});
});
