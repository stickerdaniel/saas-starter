import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deskComputerFrameCss, type FrameSources } from './desk-computer-frame';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom') as { JSDOM: new () => { window: Window } };
const root = path.join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const sources: FrameSources = {
	layout: read('src/routes/layout.css'),
	component: read('src/lib/components/desk-computer/DeskComputer.svelte'),
	figure: read('src/lib/components/desk-computer/desk-computer.svg'),
	tailwindTheme: readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8')
};

/** The light and the dark frame image of a generated stylesheet, decoded. */
function frames(css: string) {
	const images = [...css.matchAll(/url\("data:image\/svg\+xml,([^"]*)"\)/g)].map(([, data]) =>
		decodeURIComponent(data!)
	);
	expect(images).toHaveLength(2);
	return { light: images[0]!, dark: images[1]! };
}

describe('desk computer stylesheet frame', () => {
	it('paints well-formed SVG images, which browsers parse as XML', () => {
		const { window } = new JSDOM();
		for (const image of Object.values(frames(deskComputerFrameCss(sources)))) {
			const document = new window.DOMParser().parseFromString(image, 'image/svg+xml');
			expect(document.querySelector('parsererror')).toBeNull();
			expect(document.querySelectorAll('[data-key]')).toHaveLength(58);
		}
	});

	it("carries a fork's theme tokens into the frame of each theme", () => {
		const layout = sources.layout
			.replace(/(:root \{[^}]*--background:)[^;]*;/, '$1 oklch(0.97 0.03 150);')
			.replace(/(\.dark \{[^}]*--card:)[^;]*;/, '$1 oklch(0.25 0.05 150);');
		const { light, dark } = frames(deskComputerFrameCss({ ...sources, layout }));

		expect(light).toContain('--background:oklch(0.97 0.03 150)');
		expect(dark).toContain('--card:oklch(0.25 0.05 150)');
		expect(dark).not.toContain('--background:oklch(0.97 0.03 150)');
	});

	it('names a token the figure uses that the theme no longer defines', () => {
		const layout = sources.layout.replace(/--muted-foreground:[^;]*;/g, '');
		expect(() => deskComputerFrameCss({ ...sources, layout })).toThrow('--muted-foreground');
	});
});
