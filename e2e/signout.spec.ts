import { test as base, expect, type Page, type Route } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import { createUser } from './global-setup';
import { signInAsTestUser, waitForAuthenticated } from './utils/auth';
import { resolveConvexUrl } from './utils/convex-url';

const test = base.extend<{ signoutPage: Page }>({
	signoutPage: async ({ page }, use) => {
		const secret = process.env.AUTH_E2E_TEST_SECRET;
		const convexUrl = resolveConvexUrl();
		if (!secret || !convexUrl) throw new Error('The isolated E2E backend must be ready');
		const client = new ConvexHttpClient(convexUrl);
		const user = {
			email: `signout-${crypto.randomUUID()}@e2e.example.com`,
			password: 'TestPassword123!',
			name: 'E2E Signout User'
		};
		try {
			await createUser(user, secret, client);
			await signInAsTestUser(page, user);
			await use(page);
		} finally {
			await client.mutation(api.tests.deleteTestUser, { email: user.email, secret });
		}
	}
});

// An independent user keeps logout, uploads and thread creation from spending
// the other specs' sessions or rate limits, even when this project runs first.
test('signout works, and is not stopped by an upload in flight', async ({ signoutPage: page }) => {
	await page.goto('/app/ai-chat');
	await waitForAuthenticated(page);
	await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 15000 });
	await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });

	// Hold the storage POST open so a transfer is running across the whole logout.
	await page.route(/\/api\/storage\/upload/, (_route: Route) => {});
	await page
		.locator('input[type="file"]')
		.first()
		.setInputFiles({
			name: 'in-flight.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('Signout regression notes.\n', 'utf8')
		});
	await expect(page.getByTestId('attachment-chip').first().getByRole('progressbar')).toBeVisible({
		timeout: 15000
	});

	// A draft, so there is something of this person's in storage to leave behind.
	const secret = 'Half a sentence nobody else should read';
	await page.locator('textarea').fill(secret);
	/** Everything the chat surfaces are keeping in this browser. */
	const chatState = () =>
		page.evaluate(() =>
			Object.keys(localStorage)
				.filter((key) => key.startsWith('drafts:') || key.startsWith('attachments:'))
				.map((key) => localStorage.getItem(key) ?? '')
		);
	await expect.poll(async () => (await chatState()).join('')).toContain(secret);

	// Click user menu and sign out
	await page.locator('#user-menu-trigger').click();
	await page.locator('[data-testid="logout-button"]').click();

	// Should redirect away from app after logout (to home or signin page)
	// With i18n, this could be /en, /en/signin, etc.
	await page.waitForURL(/.*\/[a-z]{2}(\/signin)?(\?.*)?$/, { timeout: 15000 });

	// Nothing this person wrote greets whoever signs in next on this browser.
	// Emptied rather than removed, so a store still alive cannot put it back.
	const remaining = await chatState();
	expect(remaining.length).toBeGreaterThan(0);
	expect(remaining.every((value) => value === '{}')).toBe(true);
});
