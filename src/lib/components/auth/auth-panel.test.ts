import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$app/state', () => ({ page: { params: { lang: 'de' } } }));

import AuthPanelHarness from './test-fixtures/AuthPanelHarness.svelte';

type Harness = { boundTermsLink: () => HTMLAnchorElement | null };
let component: ReturnType<typeof mount> | undefined;

async function render(variant: 'legal' | 'footer' | 'bare', transition = false) {
	component = mount(AuthPanelHarness, { target: document.body, props: { variant, transition } });
	await tick();
	return component as unknown as Harness;
}

function card() {
	return document.querySelector<HTMLElement>('[data-slot=card]')!;
}
function links() {
	return Array.from(document.querySelectorAll('a')).map((a) => [
		a.textContent?.trim(),
		a.getAttribute('href')
	]);
}

afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.replaceChildren();
});

describe('AuthPanel', () => {
	it('renders the page inside the card with the localized legal footer below it', async () => {
		await render('legal');

		expect(card().querySelector('h1')?.textContent).toBe('Page content');
		const footer = card().nextElementSibling!;
		expect(footer.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'By clicking continue, you agree to our Terms of Service and Privacy Policy. Back to home'
		);
		expect(links()).toEqual([
			['Terms of Service', '/de/terms'],
			['Privacy Policy', '/de/privacy'],
			['Back to home', '/de/']
		]);
		expect(footer.querySelectorAll('a')).toHaveLength(3);
	});

	it('binds the rendered terms link for a form that hands focus to it', async () => {
		const harness = await render('legal', true);

		const terms = harness.boundTermsLink();
		expect(terms).toBeInstanceOf(HTMLAnchorElement);
		expect(terms).toBe(document.querySelector('a[href="/de/terms"]'));
		terms!.focus();
		expect(document.activeElement?.textContent).toBe('Terms of Service');
	});

	// The class names the card's view transition between sign-in and sign-up.
	it('names the card for the auth view transition only when asked', async () => {
		await render('legal', true);
		expect(card().classList).toContain('auth-card-transition');
		unmount(component!);
		component = undefined;

		await render('legal');
		expect(card().classList).not.toContain('auth-card-transition');
	});

	it('renders a page footer in the legal footer position instead of the terms', async () => {
		await render('footer');

		const footer = card().nextElementSibling!;
		expect(footer.textContent?.replace(/\s+/g, ' ').trim()).toBe('Page helper text Settings');
		expect(links()).toEqual([['Settings', '/de/app/settings?tab=security']]);
		expect(footer.querySelector('a')?.textContent).toBe('Settings');
	});

	it('leaves nothing below the card without a footer', async () => {
		await render('bare');

		expect(card().querySelector('h1')?.textContent).toBe('Page content');
		expect(card().nextElementSibling).toBeNull();
		expect(links()).toEqual([]);
	});
});
