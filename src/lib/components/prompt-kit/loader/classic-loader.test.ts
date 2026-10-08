import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type * as Svelte from 'svelte';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { compile, optimize } from '@tailwindcss/node';
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

/**
 * Each spoke rests at opacity 0 and only shows while its fade animation runs, so
 * removing the animation for reduced motion without restoring opacity left the
 * loader blank. The spokes are styled by the app stylesheet compiled for the
 * rendered classes, cascaded by jsdom under an emulated motion preference.
 */

type Motion = 'reduce' | 'no-preference';

const layoutCss = join(import.meta.dirname, '../../../../routes/layout.css');

/**
 * Mirrors a browser's media evaluation for the one feature under test: `all`,
 * `screen` and `prefers-reduced-motion` resolve, every other feature misses,
 * as it does in jsdom.
 */
function matchesMedium(medium: string, motion: Motion): boolean {
	return medium.split(/\s+and\s+/).every((part) => {
		if (part === 'all' || part === 'screen') return true;
		const feature = /^\(prefers-reduced-motion(?::\s*(reduce|no-preference))?\)$/.exec(part);
		return feature !== null && (feature[1] ?? 'reduce') === motion;
	});
}

/**
 * The style rules of `sheet` that apply under `motion`, in cascade order:
 * layers in declaration order, then unlayered rules. jsdom resolves specificity
 * and source order itself but skips layer blocks and media features.
 */
function cascadeFor(sheet: CSSStyleSheet, motion: Motion): string {
	const layers = new Map<string, string[]>();
	const unlayered: string[] = [];
	const layer = (name: string) => layers.get(name) ?? layers.set(name, []).get(name)!;
	const visit = (rules: CSSRuleList, scope?: string) => {
		for (const rule of rules) {
			if (rule instanceof CSSLayerStatementRule) {
				for (const name of rule.nameList) layer(scope ? `${scope}.${name}` : name);
			} else if (rule instanceof CSSLayerBlockRule) {
				const name = scope ? `${scope}.${rule.name}` : rule.name;
				layer(name);
				visit(rule.cssRules, name);
			} else if (rule instanceof CSSMediaRule) {
				if (Array.from(rule.media).some((medium) => matchesMedium(medium, motion))) {
					visit(rule.cssRules, scope);
				}
			} else if (rule instanceof CSSStyleRule) {
				(scope ? layer(scope) : unlayered).push(rule.cssText);
			}
		}
	};
	visit(sheet.cssRules);
	return [...[...layers.values()].flat(), ...unlayered].join('\n');
}

/** Computed opacity and animation of every element under `motion`. */
function paint(sheet: CSSStyleSheet, motion: Motion) {
	const style = document.createElement('style');
	style.textContent = cascadeFor(sheet, motion);
	document.head.append(style);
	const elements = [...document.body.querySelectorAll('*')].map((element) => {
		const { opacity, animation } = getComputedStyle(element);
		return { element, opacity, animation };
	});
	style.remove();
	return elements;
}

/** Opacity at each offset of the keyframes an `animation` value runs, if any. */
function keyframeOpacity(
	sheet: CSSStyleSheet,
	animation: string
): Record<string, string> | undefined {
	const keyframes = [...sheet.cssRules].find(
		(rule): rule is CSSKeyframesRule =>
			rule instanceof CSSKeyframesRule && animation.split(/\s+/).includes(rule.name)
	);
	if (!keyframes) return undefined;
	return Object.fromEntries(
		[...keyframes.cssRules].map((frame) => {
			const { keyText, style } = frame as CSSKeyframeRule;
			return [keyText, style.opacity];
		})
	);
}

let host: ReturnType<typeof mount> | undefined;

afterEach(async () => {
	if (host) await unmount(host);
	host = undefined;
	document.head.replaceChildren();
	document.body.replaceChildren();
});

it('shows still spokes in place of the fade when motion is reduced', async () => {
	host = mount(ClassicLoader, { target: document.body });
	flushSync();
	const candidates = new Set(
		[...document.body.querySelectorAll('*')].flatMap((element) => [...element.classList])
	);
	const compiler = await compile(readFileSync(layoutCss, 'utf8'), {
		base: dirname(layoutCss),
		onDependency() {}
	});
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(optimize(compiler.build([...candidates])).code);

	const moving = paint(sheet, 'no-preference').filter(({ animation }) =>
		keyframeOpacity(sheet, animation)
	);
	const reduced = paint(sheet, 'reduce');

	expect(moving).toHaveLength(12);
	for (const spoke of moving) {
		// With motion, a spoke rests hidden and fades in once per cycle.
		expect(spoke.opacity).toBe('0');
		expect(keyframeOpacity(sheet, spoke.animation)).toEqual({ '0%': '0', '100%': '1' });

		const still = reduced.find(({ element }) => element === spoke.element);
		expect(still).toMatchObject({ opacity: '1', animation: 'none' });
	}
});
