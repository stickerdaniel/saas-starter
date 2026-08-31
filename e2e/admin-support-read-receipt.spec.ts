import { test, expect, type Locator, type Page } from '@playwright/test';
import 'varlock/auto-load';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../src/lib/convex/_generated/api';
import { resolveConvexUrl } from './utils/convex-url';
import { getPreviewBypass } from './utils/preview-bypass';
import { resolveSiteUrl } from './utils/site-url';

const convexUrl = resolveConvexUrl();
const siteUrl = resolveSiteUrl();
const testSecret = process.env.AUTH_E2E_TEST_SECRET!;
const bypass = getPreviewBypass();

test('shows an unread support reply and reports when the customer opens it', async ({
	page: adminPage,
	browser
}) => {
	const anonymousUserId = `anon_${crypto.randomUUID()}`;
	const client = new ConvexHttpClient(convexUrl);
	const { threadId, threadIds, reply } = await client.mutation(
		api.tests.createUnreadAnonymousSupportReply,
		{
			secret: testSecret,
			anonymousUserId,
			newerThreadCount: 20
		}
	);
	const userContext = await browser.newContext({
		baseURL: siteUrl,
		extraHTTPHeaders: { ...bypass.headers, 'cache-control': 'no-cache' }
	});
	const userPage = await userContext.newPage();

	// The badge stays mounted at zero so its closing transition can play, so
	// "no unread reply" is now a question about what is shown, not what exists.
	const shownIndicators = (scope: Page | Locator) =>
		scope.getByTestId('support-unread-indicator').filter({ visible: true });

	try {
		await adminPage.goto(`/admin/support?thread=${threadId}`);
		await expect(adminPage.getByTestId('support-user-read-status')).toHaveText('Not read yet');

		await userPage.addInitScript((id) => {
			localStorage.setItem('supportUserId', JSON.stringify(id));
		}, anonymousUserId);
		await userPage.goto('/');

		const launcher = userPage.getByRole('button', {
			name: 'Open feedback, 1 unread support conversation'
		});
		await expect(launcher).toBeVisible();
		await expect(launcher.getByTestId('support-unread-indicator')).toBeVisible();
		await launcher.click();

		const closeLauncher = userPage.getByRole('button', { name: 'Close feedback' });
		const unreadThread = userPage.getByRole('button', { name: new RegExp(reply) });
		const showOlder = userPage.getByRole('button', { name: 'Show older conversations' });
		async function revealUnreadThread() {
			await showOlder.click();
			await expect(unreadThread.getByTestId('support-unread-indicator')).toBeVisible();
		}

		await expect(shownIndicators(closeLauncher)).toHaveCount(0);
		await expect(unreadThread).toHaveCount(0);
		await revealUnreadThread();

		await closeLauncher.click();
		await expect(launcher.getByTestId('support-unread-indicator')).toBeVisible();
		await expect(adminPage.getByTestId('support-user-read-status')).toHaveText('Not read yet');

		await launcher.click();
		await revealUnreadThread();
		await unreadThread.click();
		await expect(shownIndicators(userPage)).toHaveCount(0);

		await expect(adminPage.getByTestId('support-user-read-status')).toContainText('Read ');
	} finally {
		await userContext.close();
		await client.mutation(api.tests.cleanupAnonymousSupportThreads, {
			secret: testSecret,
			threadIds
		});
	}
});
