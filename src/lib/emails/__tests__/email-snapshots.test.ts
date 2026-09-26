// @vitest-environment node
// The real-render cases start the builder's Vite server, and esbuild refuses to run under jsdom.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { ViteDevServer } from 'vite';
import * as generated from '../generated/index';
import { EMAIL_TEMPLATES } from '../templates/registry';
import { LEGAL_CONFIG } from '$lib/config/legal';
import { createViteServer } from '../../../../scripts/build-emails';

// The parsed-output cases still need a DOM, so they build one with the jsdom package the
// jsdom environment uses. jsdom ships no type declarations; this names the part used here.
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
	JSDOM: new (html: string) => { window: Window & typeof globalThis };
};

type LegalSlots = Record<'brandName' | 'companyName' | 'address', string>;

const outputNames = Object.values(EMAIL_TEMPLATES).map(({ outputName }) => outputName);

function collapse(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/** The HTML template a generated module exports for a registry entry. */
function generatedHtml(outputName: string): string {
	const html = (generated as Record<string, unknown>)[`${outputName.toUpperCase()}_HTML`];
	if (typeof html !== 'string')
		throw new Error(`The generated index exports no ${outputName} HTML`);
	return html;
}

/**
 * Renders every template for an identity the way `bun run build:emails` does: the builder's
 * Vite server renders the Svelte components through the repository renderer. The served
 * LEGAL_CONFIG is changed only in that server's memory and restored afterwards. `year` fakes
 * the clock the footer reads its copyright year from.
 */
async function buildForIdentity(vite: ViteDevServer, identity: LegalSlots, year: number) {
	const { LEGAL_CONFIG: served } = (await vite.ssrLoadModule('/src/lib/config/legal.ts')) as {
		LEGAL_CONFIG: LegalSlots;
	};
	const { renderer } = (await vite.ssrLoadModule('/src/lib/emails/renderer.ts')) as {
		renderer: { render: (component: unknown, options: { props: unknown }) => Promise<string> };
	};
	const server = (await vite.ssrLoadModule('@better-svelte-email/server')) as {
		toPlainText: (html: string) => string;
	};
	const original = { ...served };
	Object.assign(served, identity);
	vi.useFakeTimers({ toFake: ['Date'], now: new Date(year, 5, 15) });
	try {
		const built: Array<{ name: string; html: string; text: string }> = [];
		for (const [name, { props }] of Object.entries(EMAIL_TEMPLATES)) {
			const component = (
				(await vite.ssrLoadModule(`/src/lib/emails/templates/${name}.svelte`)) as {
					default: unknown;
				}
			).default;
			const html = await renderer.render(component, { props });
			built.push({ name, html, text: server.toPlainText(html) });
		}
		return built;
	} finally {
		vi.useRealTimers();
		Object.assign(served, original);
	}
}

interface DarkRule {
	/** The selector the declarations style, with nested selectors resolved against their parent. */
	selector: string;
	/** Whether the dark media rule sits inside the selector it styles. */
	nested: boolean;
	style: CSSStyleDeclaration;
}

/** The only colour-scheme condition the email renderer emits, in normalized media text. */
const DARK_SCHEME = '(prefers-color-scheme: dark)';

/** Collapses the whitespace CSSOM keeps around media-condition tokens. */
function normalizeMedia(mediaText: string): string {
	return mediaText
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.replace(/\(\s*/g, '(')
		.replace(/\s*\)/g, ')')
		.replace(/\s*:\s*/g, ': ')
		.trim();
}

/**
 * Collects every declaration block jsdom's CSSOM places under the dark colour-scheme query.
 * Any other media condition that names prefers-color-scheme, such as a negated or combined
 * one, fails instead of being mistaken for dark.
 */
function darkRules(document: Document): DarkRule[] {
	const { CSSStyleRule, CSSMediaRule } = document.defaultView!;
	const found: DarkRule[] = [];
	const visit = (
		rules: CSSRuleList,
		selector: string | undefined,
		dark: boolean,
		nested: boolean
	) => {
		for (const rule of rules) {
			if (rule instanceof CSSStyleRule) {
				const own =
					selector === undefined
						? rule.selectorText
						: rule.selectorText.includes('&')
							? rule.selectorText.replaceAll('&', `:is(${selector})`)
							: `:is(${selector}) ${rule.selectorText}`;
				if (dark && rule.style.length > 0) found.push({ selector: own, nested, style: rule.style });
				visit(rule.cssRules, own, dark, nested);
			} else if (rule instanceof CSSMediaRule) {
				const media = normalizeMedia(rule.media.mediaText);
				if (media !== DARK_SCHEME && media.includes('prefers-color-scheme')) {
					throw new Error(
						`Unsupported colour-scheme media condition \`@media ${rule.media.mediaText}\`. Email dark rules must use exactly \`@media ${DARK_SCHEME}\`, nested inside their selector; keep the final email-safe dark variant definition in renderer.ts.`
					);
				}
				const entersDark = !dark && media === DARK_SCHEME;
				visit(
					rule.cssRules,
					selector,
					dark || entersDark,
					entersDark ? selector !== undefined : nested
				);
			} else if (dark && selector !== undefined && 'style' in rule) {
				// Declarations written directly inside a nested at-rule belong to the enclosing selector.
				found.push({ selector, nested, style: (rule as CSSStyleRule).style });
			}
		}
	};
	for (const sheet of document.styleSheets) visit(sheet.cssRules, undefined, false, false);
	return found;
}

/** The last dark declaration of `property` that applies to `element`, with its priority. */
function darkValue(rules: DarkRule[], element: Element, property: string) {
	const rule = rules.findLast(
		({ selector, style }) => style.getPropertyValue(property) !== '' && element.matches(selector)
	);
	return rule
		? {
				value: rule.style.getPropertyValue(property),
				important: rule.style.getPropertyPriority(property) === 'important'
			}
		: undefined;
}

/** The innermost element whose text contains every given string. */
function innermostContaining(document: Document, texts: string[]): HTMLElement {
	const element = [...document.body.querySelectorAll<HTMLElement>('*')].findLast((candidate) =>
		texts.every((text) => candidate.textContent?.includes(text))
	);
	if (!element) throw new Error(`No element contains ${texts.join(', ')}`);
	return element;
}

describe('Generated Email Templates', () => {
	// Setup writes each project's brand, company, and address into LEGAL_CONFIG, and the
	// email header and footer render them. The builder bakes them, and the build year, into
	// the generated templates, so every template must place each value in its own slot.
	describe('Legal identity against the real renderer', () => {
		let vite: ViteDevServer | undefined;
		beforeAll(async () => {
			vite = await createViteServer();
		}, 60_000);
		afterAll(async () => {
			await vite?.close();
		});

		const thisYear = new Date().getFullYear();
		it.each<[string, LegalSlots, number]>([
			[
				'markup characters',
				{
					brandName: 'Northwind <Labs> & "Co"',
					companyName: 'Northwind & <Partners> "Ltd."',
					address: '1 <Harbour> Road & "Quay",\u00a0Portsmouth'
				},
				thisYear
			],
			[
				'equal brand and company',
				{ brandName: 'Northwind', companyName: 'Northwind', address: '1 Harbour Road, Portsmouth' },
				thisYear
			],
			['another calendar year', LEGAL_CONFIG, thisYear + 1]
		])(
			'renders the header and footer identity for %s',
			async (_, identity, year) => {
				const built = await buildForIdentity(vite!, identity, year);
				const brand = collapse(identity.brandName);
				const company = collapse(identity.companyName);
				const address = collapse(identity.address);
				for (const { name, html, text } of built) {
					const dom = new JSDOM(html);
					try {
						const { body } = dom.window.document;
						const logo = body.querySelector('img');
						expect(logo?.getAttribute('alt'), `${name} logo alt`).toBe(
							`${identity.brandName} Logo`
						);
						expect(collapse(logo?.parentElement?.textContent ?? ''), `${name} header brand`).toBe(
							brand
						);
						const paragraphs = [...body.querySelectorAll('p')].map((p) =>
							collapse(p.textContent ?? '')
						);
						expect(paragraphs, `${name} footer copyright`).toContain(
							`Copyright © ${year} ${company} All rights reserved.`
						);
						expect(paragraphs.at(-1), `${name} footer address`).toBe(address);
					} finally {
						dom.window.close();
					}

					const blocks = text.split(/\n\s*\n/).map(collapse);
					expect(blocks[0], `${name} plain-text brand`).toBe(brand);
					expect(
						blocks.some((block) => block.startsWith(`Copyright © ${year} ${company} `)),
						`${name} plain-text copyright names ${year} and ${company}`
					).toBe(true);
					expect(blocks.at(-1), `${name} plain-text address`).toBe(address);
				}
			},
			60_000
		);
	});

	// Dark mode has two halves that are each easy to drop by accident, and each
	// half fails silently: removing the meta tags keeps Apple Mail on a pure white
	// page, and dropping the renderer's final email-safe `dark` definition lets the
	// app variant compile every dark: utility to an unmatchable `.dark` ancestor.
	// Assert on the generated output's parsed CSS, which is what the mail client
	// receives. This proves the CSS shape, not how any client paints it.
	describe('Dark mode', () => {
		const doms = new Map<string, InstanceType<typeof JSDOM>>();
		beforeAll(() => {
			for (const outputName of outputNames)
				doms.set(outputName, new JSDOM(generatedHtml(outputName)));
		});
		afterAll(() => {
			for (const dom of doms.values()) dom.window.close();
		});
		const documentFor = (outputName: string) => doms.get(outputName)!.window.document;

		it.each(outputNames)('%s declares both colour-scheme meta tags', (outputName) => {
			const document = documentFor(outputName);
			for (const name of ['color-scheme', 'supported-color-schemes']) {
				expect(
					document.querySelector(`meta[name="${name}"]`)?.getAttribute('content'),
					`${outputName} is missing <meta name="${name}" content="light dark">. Apple Mail never enters dark mode without both colour-scheme meta tags and renders the message pure white instead. Keep them in src/lib/emails/components/layout/EmailHead.svelte.`
				).toBe('light dark');
			}
		});

		// The hand-written body rule in EmailHead.svelte always survives, so it must
		// not count: the template's own elements need dark rules of their own.
		it.each(outputNames)('%s styles its own elements for the dark scheme', (outputName) => {
			const document = documentFor(outputName);
			const applied = darkRules(document).filter(
				({ selector }) => document.body.querySelector(selector) !== null
			);
			expect(
				applied.length,
				`${outputName} has no prefers-color-scheme: dark rule for any element inside <body>, so it carries the colour-scheme meta tags without matching dark styles, which is worse than no dark mode at all. A dark: class must emit \`.dark_<name> { @media (prefers-color-scheme: dark) { ... } }\`. Keep the final email-safe dark variant definition after the app CSS in renderer.ts.`
			).toBeGreaterThan(0);
		});

		it.each(outputNames)('%s nests every dark rule inside its selector', (outputName) => {
			expect(
				darkRules(documentFor(outputName))
					.filter(({ nested }) => !nested)
					.map(({ selector }) => selector),
				`${outputName} has a flat top-level @media (prefers-color-scheme: dark) block. The shape must stay nested inside its selector, as \`selector { @media (prefers-color-scheme: dark) { ... } }\`: Outlook does not parse CSS nesting and leaves its own inversion alone, where a flat block collapses the card into the surrounding greys.`
			).toEqual([]);
		});

		it.each(outputNames)('%s has no dark rule that no element can match', (outputName) => {
			const document = documentFor(outputName);
			expect(
				darkRules(document)
					.filter(({ selector }) => document.querySelector(selector) === null)
					.map(({ selector }) => selector),
				`${outputName} has dark rules that match no element, such as a \`.dark\` ancestor no mail client ever renders, so those dark: utilities are dead. Keep the email-safe \`@custom-variant dark\` definition after the app CSS in renderer.ts so Tailwind uses it last.`
			).toEqual([]);
		});

		it('signup output gives its badge and detail panel their own dark colours', () => {
			const outputName = EMAIL_TEMPLATES.NewUserSignupNotificationEmail!.outputName;
			const document = documentFor(outputName);
			const rules = darkRules(document);
			const panel = innermostContaining(document, [
				'{{nameLabel}}',
				'{{emailLabel}}',
				'{{methodLabel}}',
				'{{timeLabel}}'
			]);
			const badge = innermostContaining(document, ['{{badgeText}}']);

			// Inline light styles beat any class rule, so a dark override only applies with !important.
			const panelBackground = darkValue(rules, panel, 'background-color');
			expect(
				panelBackground,
				`${outputName} must give the signup detail panel an !important dark background. Without its own dark: background, the panel stays light against the dark card.`
			).toMatchObject({ important: true });
			let surround: ReturnType<typeof darkValue>;
			for (let parent = panel.parentElement; parent && !surround; parent = parent.parentElement) {
				surround = darkValue(rules, parent, 'background-color');
			}
			expect(
				panelBackground?.value,
				`${outputName} must keep the signup detail panel distinct from the card behind it in dark mode.`
			).not.toBe(surround?.value);

			// The badge keeps its blue fill and white text in both schemes, so client
			// inversion cannot wash it out or reduce its text contrast.
			for (const property of ['background-color', 'color']) {
				expect(
					darkValue(rules, badge, property),
					`${outputName} must give the signup badge an !important dark ${property} equal to its light one. The badge's dark: overrides keep client inversion from recolouring it.`
				).toEqual({ value: badge.style.getPropertyValue(property), important: true });
			}
		});
	});
});
