import { expect, type Page, type Route } from '@playwright/test';
import { test } from './utils/test';
import { servedByDevServer } from './utils/dev-server';

// Cheaper layers rejected because: the menu's chunk loads on first activation,
// and only a browser orders the real pointer, touch and key events against a
// chunk that is still on the network, moves focus, and runs the reload app.html
// performs when that chunk fails. A request never opens a menu.

type SentinelWindow = Window & { __reloadSentinel?: boolean };

/** A light prerendered page with the marketing header. */
const PAGE = '/en/privacy';

async function openPage(page: Page): Promise<void> {
	await page.goto(PAGE);
	// `goto` resolves on the load event, which can arrive before the header's
	// handlers exist. The announcer mounts from the root afterNavigate, after them.
	await expect(page.locator('#svelte-announcer')).toBeAttached({ timeout: 30_000 });
}

function languageTrigger(page: Page) {
	return page.getByRole('button', { name: 'Change language' });
}

/**
 * Holds every script request from now on until `release`, the menu's chunk
 * among them. Built chunks carry only a hash, so the chunk cannot be named.
 */
async function holdScripts(page: Page) {
	const held: Route[] = [];
	let holding = true;
	await page.route('**/*', async (route) => {
		if (!holding || route.request().resourceType() !== 'script') return route.fallback();
		held.push(route);
	});
	return {
		count: () => held.length,
		release: async () => {
			holding = false;
			await Promise.all(held.splice(0).map((route) => route.fallback()));
		}
	};
}

async function focusInMenu(page: Page): Promise<string | null> {
	return page.evaluate(() => {
		const focused = document.activeElement;
		return focused?.closest('[role="menu"]') ? focused.getAttribute('role') : null;
	});
}

type Activation = {
	name: string;
	keyboard: boolean;
	/** Runs while the chunk is held. */
	start: (page: Page) => Promise<void>;
	/** Runs once the menu is open: the rest of a press that straddles the load. */
	finish?: (page: Page) => Promise<void>;
};

const activations: Activation[] = [
	{
		name: 'a mouse press',
		keyboard: false,
		start: async (page) => {
			const box = (await languageTrigger(page).boundingBox())!;
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.down();
		},
		finish: (page) => page.mouse.up()
	},
	{
		name: 'Enter',
		keyboard: true,
		start: async (page) => {
			await languageTrigger(page).focus();
			await page.keyboard.press('Enter');
		}
	},
	{
		name: 'Space',
		keyboard: true,
		start: async (page) => {
			await languageTrigger(page).focus();
			await page.keyboard.down('Space');
		},
		finish: (page) => page.keyboard.up('Space')
	},
	{
		name: 'ArrowDown',
		keyboard: true,
		start: async (page) => {
			await languageTrigger(page).focus();
			await page.keyboard.press('ArrowDown');
		}
	}
];

async function expectOpensOnceAfterRelease(page: Page, activation: Activation) {
	const scripts = await holdScripts(page);
	await activation.start(page);
	await expect.poll(scripts.count).toBeGreaterThan(0);
	await expect(page.getByRole('menu')).toHaveCount(0);

	await scripts.release();
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	await activation.finish?.(page);
	// A trailing click or key release that toggled the menu would close it here.
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
	);
	await expect(menu).toBeVisible();
	await expect(page.getByRole('menu')).toHaveCount(1);
	await expect.poll(() => focusInMenu(page)).toBe(activation.keyboard ? 'menuitemradio' : 'menu');

	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect(languageTrigger(page)).toBeFocused();
}

test('the language menu loads once the page is idle', async ({ page }) => {
	await openPage(page);

	await expect(languageTrigger(page)).toHaveAttribute('data-dropdown-menu-trigger', '');
});

test.describe('language menu on first activation', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			window.requestIdleCallback = () => 0;
		});
	});

	for (const activation of activations) {
		test(`opens once on ${activation.name} while its chunk is loading`, async ({ page }) => {
			await openPage(page);
			await expectOpensOnceAfterRelease(page, activation);
		});
	}

	test('switches the language from a menu that loaded on focus', async ({ page, context }) => {
		await openPage(page);
		await languageTrigger(page).focus();
		await expect(page.locator('[data-dropdown-menu-trigger]')).toHaveCount(1);
		await expect(languageTrigger(page)).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(page.getByRole('menuitemradio', { name: 'English' })).toBeFocused();
		await page.getByRole('menuitemradio', { name: 'Deutsch' }).click();

		await expect(page).toHaveURL(/\/de\/privacy$/);
		const cookies = await context.cookies();
		expect(cookies.find((cookie) => cookie.name === 'lang_pref')?.value).toBe('de');
	});

	test.describe('with touch', () => {
		test.use({ hasTouch: true });

		test('opens once on a tap while its chunk is loading', async ({ page }) => {
			await openPage(page);
			await expectOpensOnceAfterRelease(page, {
				name: 'a tap',
				keyboard: false,
				start: (page) => languageTrigger(page).tap()
			});
		});
	});

	test.describe('when its chunk fails', () => {
		// The failed import still rejects after app.html started the reload.
		test.use({ allowedClientErrors: [/dynamically imported module/i] });

		test('reloads the page once', async ({ page }) => {
			await openPage(page);
			test.skip(
				await servedByDevServer(page),
				'Vite fires vite:preloadError only from the preload helper of a build'
			);
			let failing = true;
			page.on('request', (request) => {
				if (request.isNavigationRequest()) failing = false;
			});
			await page.route('**/*', (route) =>
				failing && route.request().resourceType() === 'script'
					? route.abort('failed')
					: route.fallback()
			);
			await page.evaluate(() => {
				(window as SentinelWindow).__reloadSentinel = true;
			});

			// Hovering starts the load; this page has no other chunk to load.
			await languageTrigger(page).hover();

			await expect
				.poll(() =>
					page.evaluate(() => sessionStorage.getItem('sk:preload-reloaded')).catch(() => null)
				)
				.toBe('1');
			await expect
				.poll(() =>
					page.evaluate(() => (window as SentinelWindow).__reloadSentinel).catch(() => true)
				)
				.toBeUndefined();
		});
	});
});
