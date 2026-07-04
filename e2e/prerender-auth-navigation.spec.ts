import { test, expect, type Page } from '@playwright/test';

// Regression guard for the prerendered-marketing -> /app navigation dead end
// (third regression in the app:auth invalidation series, #289 -> #575 -> this
// fix):
//
// Marketing pages prerender the root layout with an unauthenticated build-time
// snapshot (viewer: null). SvelteKit never reruns a parent server load on
// client-side navigation (sveltejs/kit#4426) and invalidate() on a prerendered
// route fetches the frozen static __data.json. Before the /app layout got its
// own server load, entering /app via SPA navigation from a marketing page kept
// the frozen viewer and rendered AuthConnectionFallback ("Connecting..." then
// "Can't reach the server") until a manual reload.
//
// Local test runs serve marketing pages via the dev server (no prerendering),
// so the frozen-data precondition only exists on CF preview/production
// deployments, where this spec runs against a real build. Locally it still
// pins the flow itself (session recovery on home, SPA navigation, app shell
// render without the fallback).

/**
 * Full-page navigation that tolerates the dev server's on-demand dependency
 * optimization. The first visit to a route makes Vite optimize newly seen deps
 * and force a reload, which surfaces as net::ERR_ABORTED on the in-flight
 * page.goto; the retry lands on the now-optimized route. Prebuilt CF/production
 * assets never trigger this, so it is a no-op there.
 */
async function gotoStable(page: Page, url: string) {
	for (let attempt = 0; ; attempt++) {
		try {
			await page.goto(url, { waitUntil: 'domcontentloaded' });
			return;
		} catch (error) {
			if (attempt >= 2 || !String(error).includes('ERR_ABORTED')) throw error;
		}
	}
}

test.describe('prerendered marketing to app navigation', () => {
	test('logged-in user reaches the app via SPA navigation from home', async ({ page }) => {
		// Local-only warmup: warm the dev server's on-demand compilation for the
		// heavy authenticated tree (AuthenticatedLayout + the community-chat landing)
		// and the marketing home before the timed SPA assertion, so the SPA
		// navigation below imports already-built chunks instead of racing a cold
		// compile. CF preview/production serve prebuilt assets, so this is a no-op
		// there and does not weaken the assertion (the SPA load chain still runs
		// fresh below).
		test.setTimeout(120000);
		await gotoStable(page, '/en/app');
		await expect(page.locator('#user-menu-trigger')).toBeVisible({ timeout: 60000 });

		// Land on the (prerendered) marketing home with authenticated cookies.
		await gotoStable(page, '/en');

		// Wait for the client to recover the session from cookies: the header
		// swaps its CTAs for the Dashboard button once useAuth() reports
		// authenticated. This visibility is also the hydration signal — the button
		// renders only when the client-side useAuth() store flips to authenticated,
		// which cannot happen before the app has hydrated and is running client JS.
		// So once it is visible, the SvelteKit client router is active and will
		// intercept the click as a real client-side navigation (the path the fix
		// targets), with no separate network-settle wait needed. At this point the
		// AppAuthProvider divergence effect has also fired (and, pre-fix, consumed
		// its one invalidation against the frozen prerendered data). On a
		// prerendered deploy the pre-fix bug reproduces regardless of timing (the
		// root __data.json is a frozen static file that invalidate can never clear).
		const dashboardLink = page.getByTestId('marketing-nav-dashboard');
		await expect(dashboardLink).toBeVisible({ timeout: 30000 });

		// SPA-navigate into the app (SvelteKit intercepts the link click; no
		// full document load, which is exactly the broken path).
		await dashboardLink.click();
		await page.waitForURL(/\/en\/app/, { timeout: 30000 });

		// The authenticated shell must render from the /app layout's fresh server
		// data. #user-menu-trigger is the shell's user menu, rendered only when the
		// layout resolved a viewer, so its visibility proves the frozen null viewer
		// was overridden. /app redirects to /app/community-chat.
		await expect(page.locator('#user-menu-trigger')).toBeVisible({ timeout: 30000 });
		await expect(page).toHaveURL(/\/en\/app\/community-chat/);

		// ...and the connection fallback (the old dead end) must not be shown.
		await expect(page.getByTestId('auth-connection-fallback')).toHaveCount(0);
	});
});
