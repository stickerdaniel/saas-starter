import { test, expect, type Page } from '@playwright/test';
import 'varlock/auto-load';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import { submitSignInForm, waitForAuthenticated } from './utils/auth';
import { resolveConvexUrl } from './utils/convex-url';
import { getPreviewBypass } from './utils/preview-bypass';
import { resolveSiteUrl } from './utils/site-url';

/**
 * Cheaper layers rejected because: the investigation is a session swap that
 * only a browser holds. Starting it from a message route, the return target in
 * the browser's cookie jar, a second tab that boots as the customer from that
 * jar alone, and the landing back on the exact admin URL all happen between
 * Better Auth's cookies, a full document load and the server's admin gate.
 * The exit outcomes, the cookie codec and the route policy are unit tests.
 */

const convexUrl = resolveConvexUrl();
const siteUrl = resolveSiteUrl();
const testSecret = process.env.AUTH_E2E_TEST_SECRET!;
const bypass = getPreviewBypass();
const TEST_PASSWORD = 'TestPassword123!';
const RETURN_COOKIE = 'admin_investigation_return';

async function returnCookie(page: Page) {
	return (await page.context().cookies()).find((cookie) => cookie.name === RETURN_COOKIE);
}

test('a message route opens the page as the customer, and the bar returns to the ticket', async ({
	page,
	browser
}) => {
	test.setTimeout(180_000);
	const client = new ConvexHttpClient(convexUrl);
	const email = `support-investigation-${crypto.randomUUID()}@e2e.example.com`;
	const owner = `anon_${crypto.randomUUID()}`;
	const messageRoute = '/en/pricing';
	let threadId: string | undefined;

	const signUp = await fetch(`${siteUrl}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: siteUrl, ...bypass.headers },
		body: JSON.stringify({ email, password: TEST_PASSWORD, name: 'Ticket Customer' })
	});
	expect(signUp.ok).toBe(true);
	await client.mutation(api.tests.verifyTestUserEmail, { email, secret: testSecret });

	try {
		await test.step('the customer writes from a page past the one the thread began on', async () => {
			({ threadId } = await client.mutation(api.support.threads.getOrCreateWarmThread, {
				anonymousUserId: owner,
				pageUrl: `${siteUrl}/en`
			}));
			await client.mutation(api.support.messages.sendMessage, {
				threadId,
				prompt: 'The plan comparison does not load',
				anonymousUserId: owner,
				pageUrl: `${messageRoute}?plan=pro#compare`
			});
		});

		await test.step('signing in takes the ticket onto their account', async () => {
			const context = await browser.newContext({
				baseURL: siteUrl,
				storageState: { cookies: [], origins: [] },
				extraHTTPHeaders: bypass.headers
			});
			try {
				const customer = await context.newPage();
				await customer.addInitScript((id) => {
					localStorage.setItem('supportUserId', JSON.stringify(id));
				}, owner);
				await customer.goto('/en/signin');
				await submitSignInForm(customer, email, TEST_PASSWORD);
				await waitForAuthenticated(customer);
				await expect
					.poll(
						async () =>
							(
								await client.mutation(api.tests.getSupportThreadsByUserId, {
									secret: testSecret,
									userId: owner
								})
							).length,
						{ timeout: 30000 }
					)
					.toBe(0);
			} finally {
				await context.close();
			}
		});

		let origin = '';
		await test.step('the route signs the admin in as the customer on that page', async () => {
			await page.goto(`/en/admin/support?thread=${threadId}`);
			const route = page.getByTestId('admin-support-message-route');
			await expect(route).toBeVisible({ timeout: 30000 });
			await expect(route).toHaveAccessibleName(
				/^Sent from\W*\/en\/pricing\W*Open this page as the customer/
			);
			origin = page.url();
			await route.click();

			await page.waitForURL((url) => url.pathname === messageRoute, { timeout: 30000 });
			const bar = page.getByTestId('investigation-bar');
			await expect(bar.getByTestId('investigation-bar-viewing')).toContainText(email, {
				timeout: 15000
			});
			await expect(bar.getByTestId('investigation-bar-back')).toContainText('Back to Support');

			const { pathname, search } = new URL(origin);
			expect(await returnCookie(page)).toMatchObject({
				value: encodeURIComponent(`${pathname}${search}`),
				path: '/',
				sameSite: 'Lax',
				httpOnly: false
			});
			expect((await returnCookie(page))?.domain.startsWith('.')).toBe(false);
		});

		await test.step('a second tab returns to the ticket from the cookie alone', async () => {
			const second = await page.context().newPage();
			try {
				await second.goto('/en/app');
				await waitForAuthenticated(second);
				const back = second.getByTestId('investigation-bar').getByTestId('investigation-bar-back');
				await expect(back).toContainText('Back to Support', { timeout: 15000 });
				await back.click();

				await second.waitForURL(origin, { timeout: 30000 });
				await expect(second.getByTestId('admin-support-message-route')).toBeVisible({
					timeout: 30000
				});
				await expect(second.getByTestId('investigation-bar')).toHaveCount(0);
				expect(second.url()).toBe(origin);
				expect(await returnCookie(second)).toBeUndefined();
			} finally {
				await second.close();
			}
		});
	} finally {
		if (threadId) {
			await client.mutation(api.tests.cleanupAnonymousSupportThreads, {
				secret: testSecret,
				threadIds: [threadId]
			});
		}
		await client.mutation(api.tests.deleteTestUser, { email, secret: testSecret });
	}
});
