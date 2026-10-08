import { afterEach, expect, it, vi } from 'vitest';
import { mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { compile } from '@tailwindcss/node';
import { chromium } from 'playwright';
import ClassicLoader from './classic-loader.svelte';

vi.mock('svelte', () =>
	vi.importActual<typeof Svelte>('../../../../../node_modules/svelte/src/index-client.js')
);
vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('@tolgee/svelte', () => ({
	getTranslate: () => ({
		t: {
			subscribe(run: (value: (key: string) => string) => void) {
				run((key) => key);
				return () => {};
			}
		}
	})
}));

let host: ReturnType<typeof mount> | undefined;

afterEach(async () => {
	if (host) await unmount(host);
	host = undefined;
	document.body.innerHTML = '';
});

it('keeps the classic loader visible when motion is reduced', async () => {
	host = mount(ClassicLoader, { target: document.body });
	const spoke = document.querySelector<HTMLElement>('.animate-spinner-fade');
	expect(spoke).not.toBeNull();
	const classes = spoke!.className.split(/\s+/).filter(Boolean);

	const compiler = await compile('@import "tailwindcss";', {
		base: process.cwd(),
		onDependency() {}
	});
	const css = compiler.build(classes);
	const html = `<!doctype html><style>${css}</style><div id="spoke" class="${spoke!.className}"></div>`;

	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.setContent(html);
		const reduced = await page.$eval('#spoke', (element) => getComputedStyle(element).opacity);

		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.setContent(html);
		const moving = await page.$eval('#spoke', (element) => getComputedStyle(element).opacity);

		expect(reduced).toBe('1');
		expect(moving).toBe('0');
	} finally {
		await browser.close();
	}
});
