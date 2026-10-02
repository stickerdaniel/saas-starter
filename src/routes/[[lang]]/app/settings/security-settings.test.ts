import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));

vi.hoisted(() => {
	Object.defineProperty(window, 'matchMedia', {
		configurable: true,
		value: (media: string) => ({
			matches: false,
			media,
			addEventListener() {},
			removeEventListener() {}
		})
	});
});

const passkey = vi.hoisted(() => ({
	listUserPasskeys: vi.fn().mockResolvedValue({ data: [], error: null }),
	addPasskey: vi.fn(),
	deletePasskey: vi.fn()
}));
vi.mock('$lib/auth-client.js', () => ({ authClient: { passkey } }));
vi.mock('$lib/hooks/use-haptic.svelte.ts', () => ({ haptic: { trigger: vi.fn() } }));
vi.mock('$app/state', () => ({ page: { data: { lang: 'en' } } }));

import SecuritySettingsHarness from './test-fixtures/SecuritySettingsHarness.svelte';

let component: ReturnType<typeof mount> | undefined;

async function render(props: { name?: string; language?: string } = {}) {
	component = mount(SecuritySettingsHarness, { target: document.body, props });
	await tick();
	await vi.waitFor(() => expect(document.querySelector('input')).not.toBeNull());
	return component;
}

function nameInput() {
	return document.querySelector<HTMLInputElement>('input')!;
}

async function editName(name: string) {
	nameInput().value = name;
	nameInput().dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
}

async function addPasskey() {
	const button = Array.from(document.querySelectorAll('button')).find((button) =>
		button.textContent?.includes('Add Passkey')
	)!;
	button.click();
	await vi.waitFor(() => expect(passkey.addPasskey).toHaveBeenCalled());
	await tick();
}

beforeEach(() => {
	vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
	vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
	);
	passkey.addPasskey.mockResolvedValue({ data: { id: 'new-passkey' }, error: null });
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe('suggested passkey names', () => {
	it('prefills and submits the first name and detected device', async () => {
		await render({ name: '  Daniel   Example  ' });
		expect(nameInput().value).toBe('Daniel’s Mac');
		await addPasskey();
		expect(passkey.addPasskey).toHaveBeenCalledWith({ name: 'Daniel’s Mac' });
		expect(nameInput().value).toBe('Daniel’s Mac');
	});

	it.each([
		['de', 'Mac von Daniel'],
		['es', 'Mac de Daniel'],
		['fr', 'Mac de Daniel']
	])('localizes the suggestion in %s', async (language, expected) => {
		await render({ language });
		expect(nameInput().value).toBe(expected);
	});

	it('uses a friendly fallback when the profile name is missing', async () => {
		await render({ name: ' ' });
		expect(nameInput().value).toBe('My Mac');
	});

	it('uses the suggestion when the user clears the field', async () => {
		await render();
		await editName('   ');
		await addPasskey();
		expect(passkey.addPasskey).toHaveBeenCalledWith({ name: 'Daniel’s Mac' });
	});

	it('keeps an edited name through profile changes and a failed registration', async () => {
		const view = await render();
		await editName('  Work laptop  ');
		view.setName('Alex Example');
		await tick();
		expect(nameInput().value).toBe('  Work laptop  ');
		passkey.addPasskey.mockResolvedValueOnce({ error: { code: 'AUTH_CANCELLED' } });
		await addPasskey();
		expect(passkey.addPasskey).toHaveBeenLastCalledWith({ name: 'Work laptop' });
		expect(nameInput().value).toBe('  Work laptop  ');
		await addPasskey();
		expect(passkey.addPasskey).toHaveBeenLastCalledWith({ name: 'Work laptop' });
		expect(nameInput().value).toBe('Alex’s Mac');
	});

	it('updates untouched suggestions while preserving edits across language changes', async () => {
		const view = await render();
		view.setName('Alex Example');
		await tick();
		expect(nameInput().value).toBe('Alex’s Mac');
		await editName('Travel key');
		await view.setLanguage('de');
		await tick();
		expect(nameInput().value).toBe('Travel key');
	});
});
