import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { waitForAuthenticated } from './utils/auth';

test.use({ storageState: { cookies: [], origins: [] } });

import type { TestCredentials } from './utils/types';

function getUserCredentials() {
	const credentialsPath = path.join(process.cwd(), 'e2e', '.auth', 'test-credentials.json');
	if (!fs.existsSync(credentialsPath)) {
		throw new Error('test-credentials.json not found. globalSetup may have failed.');
	}

	const credentials: TestCredentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
	return credentials.user;
}

test('shows passkey last-used badge from local storage', async ({ page }) => {
	await page.goto('/signin');
	await page.evaluate(() => {
		localStorage.setItem('auth:last-auth-method', JSON.stringify('passkey'));
		sessionStorage.removeItem('auth:pending-oauth-provider');
	});
	await page.reload();
	await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 30000 });
	await expect(page.locator('[data-testid="email-input"]')).toBeEnabled({ timeout: 30000 });

	await expect(page.locator('[data-testid="oauth-passkey-last-used-badge"]')).toBeVisible();
	await expect(page.locator('[data-testid="oauth-google-last-used-badge"]')).toHaveCount(0);
	await expect(page.locator('[data-testid="oauth-github-last-used-badge"]')).toHaveCount(0);
});

test('email/password signin clears stored last-used method', async ({ page }) => {
	await page.goto('/signin');
	await page.evaluate(() => {
		localStorage.setItem('auth:last-auth-method', JSON.stringify('google'));
		sessionStorage.removeItem('auth:pending-oauth-provider');
	});
	await page.reload();
	await expect(page.locator('[data-testid="email-input"]')).toBeVisible({ timeout: 30000 });
	await expect(page.locator('[data-testid="email-input"]')).toBeEnabled({ timeout: 30000 });

	const hasGoogleOAuth =
		(await page.locator('[data-testid="signin-oauth-google-button"]').count()) > 0;
	test.skip(!hasGoogleOAuth, 'Google OAuth is disabled in this environment');

	await expect(page.locator('[data-testid="oauth-google-last-used-badge"]')).toBeVisible();

	const { email, password } = getUserCredentials();
	await page.fill('[data-testid="email-input"]', email);
	await page.fill('[data-testid="password-input"]', password);
	await page.click('[data-testid="signin-button"]');
	await waitForAuthenticated(page);

	const lastMethodAfterSignIn = await page.evaluate(() => {
		const raw = localStorage.getItem('auth:last-auth-method');
		return raw ? JSON.parse(raw) : null;
	});
	expect(lastMethodAfterSignIn).toBeNull();
});

/**
 * The badge is positioned beside the button, not inside it, so nothing in the
 * markup makes it follow the button's one-pixel press offset. That coupling is
 * a CSS selector keyed to the button's own :active state, and it depends on
 * browser hit testing: an earlier version keyed off the wrapper instead and
 * moved the badge alone whenever the button underneath was disabled, because
 * pointer-events-none sent the press to the wrapper. Neither failure is
 * reachable from a static class assertion, so it is asserted here.
 */
test('last-used badge tracks the button through a press', async ({ page }) => {
	await page.goto('/signin');
	await page.evaluate(() => {
		localStorage.setItem('auth:last-auth-method', JSON.stringify('passkey'));
		localStorage.setItem('mode-watcher-mode', 'dark');
		sessionStorage.removeItem('auth:pending-oauth-provider');
	});
	await page.reload();
	await expect(page.locator('[data-testid="email-input"]')).toBeEnabled({ timeout: 30000 });
	await expect(page.locator('html')).toHaveClass(/\bdark\b/);

	const button = page.locator('[data-testid="signin-oauth-passkey-button"]');
	const badge = page.locator('[data-testid="oauth-passkey-last-used-badge"]');
	await expect(badge).toBeVisible();

	const tops = async () => {
		const b = await button.boundingBox();
		const g = await badge.boundingBox();
		if (!b || !g) throw new Error('button or badge is not laid out');
		return { button: b.y, badge: g.y };
	};

	const box = await button.boundingBox();
	if (!box) throw new Error('button is not laid out');
	const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

	const resting = await tops();
	await page.mouse.move(centre.x, centre.y);
	await page.mouse.down();
	const pressed = await tops();
	// Release away from the button so the press does not trigger the passkey flow.
	await page.mouse.move(5, 5);
	await page.mouse.up();

	expect(pressed.button - resting.button).toBeCloseTo(1, 1);
	expect(pressed.badge - resting.badge).toBeCloseTo(1, 1);
	expect(pressed.badge - pressed.button).toBeCloseTo(resting.badge - resting.button, 1);

	// A disabled button does not move, so neither may the badge. The badge also
	// uses opaque mixed colors instead of opacity: it overlaps the button edge,
	// where transparency would let the edge show through.
	const waitForBadgeTransitions = () =>
		badge.evaluate(async (element) => {
			await Promise.all(
				element.getAnimations().map(async (animation) => {
					try {
						await animation.finished;
					} catch {
						// A superseded transition is expected to reject its finished promise.
					}
				})
			);
		});
	await waitForBadgeTransitions();
	const enabledBadgeStyle = await badge.evaluate((element) => {
		const style = getComputedStyle(element);
		return { backgroundColor: style.backgroundColor, color: style.color };
	});
	await button.evaluate((el: HTMLButtonElement) => {
		el.disabled = true;
	});
	await waitForBadgeTransitions();
	const disabledBadgeStyle = await badge.evaluate((element) => {
		const style = getComputedStyle(element);
		const probe = document.createElement('span');
		probe.style.backgroundColor = 'color-mix(in srgb, var(--secondary) 50%, var(--card))';
		probe.style.color = 'color-mix(in srgb, var(--secondary-foreground) 50%, var(--card))';
		if (!element.parentElement) throw new Error('badge is detached');
		element.parentElement.append(probe);
		const probeStyle = getComputedStyle(probe);
		const expectedBackgroundColor = probeStyle.backgroundColor;
		const expectedColor = probeStyle.color;
		probe.remove();

		const slashAlpha = style.backgroundColor.match(/\/\s*([\d.]+)(%)?\s*\)$/);
		const rgbaAlpha = style.backgroundColor.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)(%)?\s*\)$/);
		const alphaValue = slashAlpha?.[1] ?? rgbaAlpha?.[1];
		const alphaIsPercent = slashAlpha?.[2] ?? rgbaAlpha?.[2];
		const backgroundAlpha = alphaValue ? Number(alphaValue) / (alphaIsPercent ? 100 : 1) : 1;
		return {
			backgroundColor: style.backgroundColor,
			color: style.color,
			opacity: style.opacity,
			backgroundAlpha,
			expectedBackgroundColor,
			expectedColor
		};
	});
	expect(disabledBadgeStyle.backgroundColor).not.toBe(enabledBadgeStyle.backgroundColor);
	expect(disabledBadgeStyle.color).not.toBe(enabledBadgeStyle.color);
	expect(disabledBadgeStyle.backgroundColor).toBe(disabledBadgeStyle.expectedBackgroundColor);
	expect(disabledBadgeStyle.color).toBe(disabledBadgeStyle.expectedColor);
	expect(disabledBadgeStyle.opacity).toBe('1');
	expect(disabledBadgeStyle.backgroundAlpha).toBe(1);
	const disabledResting = await tops();
	await page.mouse.move(centre.x, centre.y);
	await page.mouse.down();
	const disabledPressed = await tops();
	await page.mouse.move(5, 5);
	await page.mouse.up();

	expect(disabledPressed.button - disabledResting.button).toBeCloseTo(0, 1);
	expect(disabledPressed.badge - disabledResting.badge).toBeCloseTo(0, 1);
});
