import { ConvexHttpClient } from 'convex/browser';
import { test, expect, type Page, type Route } from '@playwright/test';
import { api } from '../src/lib/convex/_generated/api';
import { readTestCredentials, waitForAuthenticated } from './utils/auth';
import { resolveConvexUrl } from './utils/convex-url';

/**
 * A file that is still transferring dies with the page, and dies quietly: the
 * progress bar disappears and the user assumes the file arrived. These assert
 * that leaving is announced, and the far more important converse, that an
 * ordinary departure is not.
 */

const NOTES = 'Navigation guard regression notes.\n';

/** Presigned storage endpoint, served by Convex rather than by a route in this repo. */
const STORAGE_UPLOAD = /\/api\/storage\/upload/;

/**
 * Hold the storage POST open so the upload stays in flight for the whole test.
 * The routes are never fulfilled; Playwright drops them when the page goes away.
 */
async function stallUpload(page: Page): Promise<void> {
	await page.route(STORAGE_UPLOAD, (_route: Route) => {
		// Deliberately unanswered: an upload that neither finishes nor fails.
	});
}

/** The attempt's progress bar; the storage POST confirms the transfer is active. */
function uploadInFlight(page: Page) {
	return page.getByTestId('attachment-chip').first().getByRole('progressbar');
}

async function attachNotes(page: Page, name: string): Promise<void> {
	// Each upload case owns its budget instead of depending on earlier suite activity.
	const secret = process.env.AUTH_E2E_TEST_SECRET;
	if (!secret) throw new Error('AUTH_E2E_TEST_SECRET is required in .env.test');
	const convex = new ConvexHttpClient(resolveConvexUrl()!);
	await convex.mutation(api.tests.resetAiChatFileUploadLimit, {
		secret,
		email: readTestCredentials().user.email
	});
	await page
		.locator('input[type="file"]')
		.first()
		.setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(NOTES, 'utf8') });
}

/**
 * Whether the page would make the browser ask before unloading.
 *
 * A synthetic beforeunload runs the same listener chain a reload does, and
 * whether it ends up prevented is exactly what decides if the browser prompts.
 * Watching for a real dialog via page.close({ runBeforeUnload: true }) looks
 * more faithful but proves nothing: Chromium raises one for the mere presence
 * of a listener, and SvelteKit always registers one, so that assertion holds
 * even with the guard removed.
 */
async function wouldPromptOnUnload(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const event = new Event('beforeunload', { cancelable: true });
		window.dispatchEvent(event);
		return event.defaultPrevented;
	});
}

/**
 * The Convex client raises its own unload warning while one of its requests is
 * outstanding (`unsavedChangesWarning`, on by default), and an upload opens
 * with one: the presigned URL. Once the storage POST goes out that request has
 * answered, and this pause covers the client's own bookkeeping, so what the
 * assertion sees afterwards is this guard and nothing else. Measured with the
 * guard removed: the page stops preventing unload about a second after the POST
 * is issued, leaving the rest of the transfer unprotected. That gap is the
 * reason this feature exists.
 */
const CONVEX_UNLOAD_WARNING_SETTLE_MS = 2000;

test.describe('Upload navigation guard', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/app/ai-chat');
		await waitForAuthenticated(page);
		await page.waitForURL(/\/app\/ai-chat\?thread=/, { timeout: 15000 });
		await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
	});

	test('leaving the page is announced while a file is transferring', async ({ page }) => {
		const storagePost = page.waitForRequest(STORAGE_UPLOAD);
		await stallUpload(page);

		await attachNotes(page, 'in-flight.txt');
		await expect(uploadInFlight(page)).toBeVisible({ timeout: 15000 });
		await storagePost;
		await page.waitForTimeout(CONVEX_UNLOAD_WARNING_SETTLE_MS);

		expect(await wouldPromptOnUnload(page)).toBe(true);
	});

	test('leaving is not announced when nothing is transferring', async ({ page }) => {
		// The guard that matters. One that prompts on every departure would be
		// worse than none: users learn to click through it.
		await page.locator('textarea').fill('No attachment here');

		// Polled rather than asserted once, because the page may still be settling
		// the warm-thread mutation it opened on arrival.
		await expect.poll(() => wouldPromptOnUnload(page), { timeout: 15000 }).toBe(false);
	});

	test('the announcement stops once the transfer settles', async ({ page }) => {
		// A stale claim is the quiet failure mode: the prompt outlives the upload
		// and the app nags for the rest of the session.
		let failNext = true;
		await page.route(STORAGE_UPLOAD, async (route: Route) => {
			if (failNext) {
				failNext = false;
				await route.abort('connectionfailed');
				return;
			}
			await route.continue();
		});

		await attachNotes(page, 'settled.txt');
		await expect(page.locator('[data-upload-failed]')).toBeVisible({ timeout: 20000 });

		await expect.poll(() => wouldPromptOnUnload(page), { timeout: 15000 }).toBe(false);
	});

	test('moving to another page is stopped and explained', async ({ page }) => {
		// The progress bar is painted when the attempt starts, before the storage
		// POST. The suite shares one user's ten-per-hour upload grant, so this
		// attempt can be refused: the bar flashes, the guard releases, and the
		// click leaves. The stall only holds the POST, so click once that request
		// is out and the budget has been given back.
		const storagePost = page.waitForRequest(STORAGE_UPLOAD);
		await stallUpload(page);
		await attachNotes(page, 'in-flight.txt');
		await storagePost;
		await expect(uploadInFlight(page)).toBeVisible({ timeout: 15000 });

		const urlBeforeClick = page.url();
		await page.getByTestId('sidebar-nav-community-chat').click();

		const notice = page.locator('[data-sonner-toast]').filter({
			hasText: /upload still in progress/i
		});
		await expect(notice).toBeVisible({ timeout: 10000 });
		expect(page.url()).toBe(urlBeforeClick);
	});
});
