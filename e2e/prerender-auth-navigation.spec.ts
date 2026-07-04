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
		test.setTimeout(180000);

		// Land on the (prerendered) marketing home with authenticated cookies.
		await gotoStable(page, '/en');

		// Wait for the client to recover the session from cookies: the header
		// swaps its CTAs for the Dashboard button once useAuth() reports
		// authenticated. This visibility is also the hydration signal, the button
		// renders only when the client-side useAuth() store flips to authenticated,
		// which cannot happen before the app has hydrated and is running client JS,
		// so once it is visible the SvelteKit client router is active and the click
		// below is a real client-side navigation (the path the fix targets). At
		// this point the AppAuthProvider divergence effect has also fired (and,
		// pre-fix, consumed its one invalidation against the frozen prerendered
		// data). On a prerendered deploy the pre-fix bug reproduces regardless of
		// timing (the root __data.json is a frozen static file that invalidate can
		// never clear).
		// Generous timeout: the fork's client auth recovery (session fetch ->
		// /convex/token -> Convex WebSocket confirm) can take a while against a
		// cold preview Convex deployment before isAuthenticated flips.
		const dashboardLink = page.getByTestId('marketing-nav-dashboard');
		await expect(dashboardLink).toBeVisible({ timeout: 60000 });

		// Ensure the client router has hydrated before clicking. On the dev server
		// the link is SSR-rendered (authenticated SSR), so it is visible before
		// hydration; a click mid-hydration gets hijacked and the navigation is
		// lost, leaving the page on home. Wait for the network to settle as the
		// hydration signal, bounded because Tolgee's dev translation polling can
		// keep the network busy indefinitely; the cap still elapses well after
		// hydration completes.
		await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

		// SPA-navigate into the app. Retry once if the dev server aborts the
		// in-flight navigation while optimizing the (heavier) authenticated route
		// tree on first visit; prebuilt CF/production assets never abort.
		for (let attempt = 0; ; attempt++) {
			try {
				await dashboardLink.click();
				// Generous: a cold dev server compiles the heavier authenticated
				// route tree on first entry; prebuilt CF/production navigates fast.
				await page.waitForURL(/\/en\/app/, { timeout: 90000 });
				break;
			} catch (error) {
				if (attempt >= 1 || !String(error).includes('ERR_ABORTED')) throw error;
				await gotoStable(page, '/en');
				await expect(dashboardLink).toBeVisible({ timeout: 30000 });
			}
		}

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
