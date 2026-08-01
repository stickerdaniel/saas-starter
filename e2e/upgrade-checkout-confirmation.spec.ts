import { test, expect, type Page } from '@playwright/test';

// Regression guard for the silent-upgrade defect: Autumn answers a checkout
// either with a hosted Stripe session or with a purchase preview that has to be
// confirmed in the app and completed with `attach`. The app only handled the
// first, so an answer without a URL left the button idle with no Stripe, no
// error and no explanation.
//
// Both specs intercept the Convex WebSocket the same way
// `upgrade-checkout-failure.spec.ts` does: everything is forwarded except the
// checkout and attach actions, which are answered synthetically so no real
// billing operation happens. The success envelope has to nest the Autumn
// response inside the Convex one — a bare preview is rejected as NO_DATA by the
// client wrapper.

const PRO = {
	id: 'pro',
	name: 'Pro',
	created_at: 1735689600000,
	env: 'sandbox',
	is_add_on: false,
	is_default: false,
	group: 'main',
	version: 1,
	items: [],
	free_trial: null,
	base_variant_id: null,
	properties: {
		is_free: false,
		is_one_off: false,
		interval_group: 'month',
		has_trial: false,
		updateable: true
	}
};

const FREE = { ...PRO, id: 'free', name: 'Free', is_default: true };

const CHECKOUT_PREVIEW = {
	url: null,
	customer_id: 'e2e-customer',
	has_prorations: false,
	lines: [{ description: 'Pro - $10 / month', amount: 10, item: {} }],
	total: 10,
	currency: 'usd',
	options: [],
	product: PRO,
	current_product: FREE
};

type ActionFrame = { type?: string; udfPath?: string; requestId?: number; args?: unknown[] };

type Intercept = {
	/** Resolves once the attach action has been requested. */
	attachRequested: Promise<{ args: unknown[] }>;
	/** Answers the held attach request. */
	resolveAttach: (payload: { data?: unknown; error?: unknown }) => void;
};

function actionResponse(requestId: number, data: unknown, error: unknown = null) {
	return JSON.stringify({
		type: 'ActionResponse',
		requestId,
		success: true,
		result: { data, error, statusCode: error ? 400 : 200 },
		logLines: []
	});
}

/**
 * Answer checkout immediately, hold attach until the test releases it.
 *
 * Holding attach is what makes the in-flight assertions possible: while the
 * purchase is being charged the dialog has to stay open and its buttons
 * disabled, including against Escape.
 */
async function interceptBilling(page: Page): Promise<Intercept> {
	let onAttachRequested: (value: { args: unknown[] }) => void;
	const attachRequested = new Promise<{ args: unknown[] }>((resolve) => {
		onAttachRequested = resolve;
	});

	let respond: ((payload: { data?: unknown; error?: unknown }) => void) | null = null;

	await page.routeWebSocket(/\/api\/[^/]+\/sync/, (ws) => {
		const server = ws.connectToServer();

		ws.onMessage((raw) => {
			if (typeof raw !== 'string') {
				server.send(raw);
				return;
			}

			let parsed: ActionFrame | null = null;
			try {
				parsed = JSON.parse(raw) as ActionFrame;
			} catch {
				/* not JSON — forward verbatim */
			}

			if (
				parsed?.type === 'Action' &&
				typeof parsed.udfPath === 'string' &&
				typeof parsed.requestId === 'number'
			) {
				if (parsed.udfPath.includes('checkout')) {
					ws.send(actionResponse(parsed.requestId, CHECKOUT_PREVIEW));
					return;
				}

				if (parsed.udfPath.includes('attach')) {
					const requestId = parsed.requestId;
					respond = (payload) => ws.send(actionResponse(requestId, payload.data, payload.error));
					onAttachRequested({ args: parsed.args ?? [] });
					return;
				}
			}

			server.send(raw);
		});

		server.onMessage((raw) => ws.send(raw));
	});

	return {
		attachRequested,
		resolveAttach: (payload) => respond?.(payload)
	};
}

test('a checkout without a hosted session is confirmed in a dialog', async ({ page }) => {
	const billing = await interceptBilling(page);

	await page.goto(`/en/pricing?cb=${Date.now()}`);
	await page.waitForLoadState('networkidle');

	const checkoutButton = page.getByTestId('pricing-checkout-pro');
	await expect(checkoutButton).toBeEnabled();
	await checkoutButton.click();

	// No URL to follow, so the purchase has to surface as a confirmation.
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible({ timeout: 10000 });
	await expect(dialog).toContainText('Pro');
	await expect(page.getByTestId('billing-checkout-total')).toHaveText('$10.00');
	await expect(page).toHaveURL(/\/en\/pricing\?/);

	const confirm = page.getByTestId('billing-checkout-confirm');
	await confirm.click();

	const { args } = await billing.attachRequested;
	expect(args?.[0]).toMatchObject({
		productId: 'pro',
		successUrl: expect.stringContaining('upgraded=true')
	});

	// While the charge is in flight the dialog must hold: both buttons locked
	// and Escape ignored, so a second click cannot double-charge.
	await expect(confirm).toBeDisabled();
	// bits-ui refuses the click but never renders the attribute, so the state
	// is asserted the way assistive tech reads it.
	await expect(page.getByTestId('billing-checkout-cancel')).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeVisible();

	billing.resolveAttach({
		data: {
			customer_id: 'e2e-customer',
			product_ids: ['pro'],
			code: 'attached',
			message: 'Product attached'
		}
	});

	await expect(dialog).toBeHidden({ timeout: 10000 });
	await expect(page).toHaveURL(/\/en\/pricing\?/);
});

test('a failed confirmation reports the error and keeps the dialog open', async ({ page }) => {
	const billing = await interceptBilling(page);

	await page.goto('/en/app/community-chat');
	await page.waitForLoadState('networkidle');

	// Started from the user menu on purpose: the dialog is mounted in the root
	// layout, so it has to survive the dropdown closing underneath it. The quota
	// banner CTA is not usable here because a fresh test user still has messages.
	await page.getByRole('button', { name: /E2E Test User/i }).click();
	await page.getByRole('menuitem', { name: /Upgrade to Pro/i }).click();

	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible({ timeout: 10000 });

	await page.getByTestId('billing-checkout-confirm').click();
	await billing.attachRequested;

	billing.resolveAttach({
		error: { message: 'Card declined', code: 'card_declined' }
	});

	await expect(
		page.locator('[data-sonner-toast]').filter({ hasText: /Could not complete the purchase/i })
	).toBeVisible({ timeout: 10000 });

	// The purchase never happened, so the customer has to be able to retry it.
	await expect(dialog).toBeVisible();
	await expect(page.getByTestId('billing-checkout-confirm')).toBeEnabled();
});
