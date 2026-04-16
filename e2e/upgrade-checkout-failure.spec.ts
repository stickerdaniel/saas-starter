import { test, expect } from '@playwright/test';

// Regression guard for #317: the Upgrade/Checkout button must surface an error
// toast when the underlying Autumn checkout action fails, instead of silently
// returning the button to idle with no feedback.
//
// Runs in the default `chromium` project using the authenticated user storage
// state prepared by globalSetup. Pricing page chosen because the Pro checkout
// button renders unconditionally for non-pro users — fresh test users always
// match that state (unlike `/app/community-chat` where the upgrade CTA is
// quota-gated).
//
// The reactive Convex client ships actions over WebSocket (see
// node_modules/convex/dist/esm/browser/sync/client.js `actionInternal` — which
// calls `webSocketManager.sendMessage`), not HTTP POST. We intercept the
// Convex WS connection with `page.routeWebSocket`, forward everything through
// unchanged, and synthesize a failed `ActionResponse` only for the checkout
// action. This keeps the rest of the page (customer sync, auth token refresh,
// etc.) working normally.

test('pricing checkout failure surfaces an error toast instead of failing silently', async ({
	page
}) => {
	await page.routeWebSocket(/convex\.cloud/, (ws) => {
		const server = ws.connectToServer();

		ws.onMessage((raw) => {
			if (typeof raw !== 'string') {
				server.send(raw);
				return;
			}
			let parsed: { type?: string; udfPath?: string; requestId?: number } | null = null;
			try {
				parsed = JSON.parse(raw);
			} catch {
				/* not JSON — forward verbatim */
			}
			if (
				parsed &&
				parsed.type === 'Action' &&
				typeof parsed.udfPath === 'string' &&
				parsed.udfPath.includes('checkout') &&
				typeof parsed.requestId === 'number'
			) {
				ws.send(
					JSON.stringify({
						type: 'ActionResponse',
						requestId: parsed.requestId,
						success: false,
						result: 'forced failure for E2E',
						logLines: []
					})
				);
				return;
			}
			server.send(raw);
		});

		server.onMessage((raw) => {
			ws.send(raw);
		});
	});

	// Pin the locale to English. `/pricing` without a prefix is redirected by
	// src/hooks.server.ts based on Accept-Language, which would randomize the
	// toast copy on non-English machines.
	await page.goto('/en/pricing');

	// Wait for the network to settle so client-side hydration has run and
	// useAuth()/useCustomer() have resolved. Without this, handleCheckout
	// sees isAuthenticated=false and redirects to /signin instead of firing
	// the checkout action.
	await page.waitForLoadState('networkidle');

	const checkoutButton = page.getByTestId('pricing-checkout-pro');
	await expect(checkoutButton).toBeVisible();
	await expect(checkoutButton).toBeEnabled();

	await checkoutButton.click();

	// Sonner renders toasts with data-sonner-toast. Assert on the English
	// billing.checkout_failed copy.
	const toast = page.locator('[data-sonner-toast]').filter({
		hasText: 'Checkout failed. Please try again.'
	});
	await expect(toast).toBeVisible({ timeout: 10000 });

	// No navigation to a checkout URL occurred.
	await expect(page).toHaveURL(/\/en\/pricing$/);

	// Button returned to idle state (no longer disabled by isLoading).
	await expect(checkoutButton).toBeEnabled();
});
