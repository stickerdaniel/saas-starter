import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import en from '../../../../i18n/en.json';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', async () => {
	const { translation } = await import('./test-fixtures/translation');
	return { getTranslate: () => ({ t: translation }) };
});

import { getRepositoryUrl } from '#lib/config/site.js';
import { useDictionary } from './test-fixtures/translation';
import MessageBuildHarness from './test-fixtures/message-build-harness.svelte';

const BUILD = '3c9d53c781b67138ebb598d7d2249f10f3af61ec';
let component: ReturnType<typeof mount> | undefined;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
	useDictionary(en);
	writeText = vi.fn(async () => undefined);
	vi.stubGlobal('isSecureContext', true);
	Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(async () => {
	if (component) await unmount(component);
	component = undefined;
	document.body.replaceChildren();
	vi.unstubAllGlobals();
	Reflect.deleteProperty(navigator, 'clipboard');
});

async function show(build: string) {
	component = mount(MessageBuildHarness, { target: document.body, props: { build } });
	await tick();
	return document.querySelector<HTMLElement>('[data-testid="admin-support-message-build"]')!;
}

/** The text a screen reader hears in the polite live region. */
function announced() {
	return document.querySelector('[aria-live="polite"]')?.textContent?.trim();
}

it('shows a commit by its short SHA and copies its repository link', async () => {
	const build = await show(BUILD);

	expect(build.tagName).toBe('BUTTON');
	expect(build.textContent).toContain('3c9d53c');
	expect(build.textContent).not.toContain(BUILD);
	build.click();
	await vi.waitFor(() => expect(announced()).toBe('Link copied'));
	// The slug is whatever template setup wrote for this app's repository.
	expect(writeText.mock.calls).toEqual([[`${getRepositoryUrl()}/commit/${BUILD}`]]);
});

it('says so when the clipboard refuses the link', async () => {
	writeText.mockRejectedValue(new Error('denied'));
	const build = await show(BUILD);

	build.click();
	await vi.waitFor(() => expect(announced()).toBe('Failed to copy'));
});

it('shows a build that names no commit as it is, with nothing to copy', async () => {
	const build = await show('dev');

	expect(build.tagName).not.toBe('BUTTON');
	expect(build.textContent).toContain('dev');
	expect(document.querySelector('button')).toBeNull();
});
