// @vitest-environment node
// The real-render cases start the builder's Vite server, and esbuild refuses to run under jsdom.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';
import { EMAIL_TEMPLATES } from '../templates/registry';
import { toPlainText } from '@better-svelte-email/server';
import { LEGAL_CONFIG } from '$lib/config/legal';
import {
	convertMarkersToTemplate,
	createViteServer,
	escapeTemplateLiteral,
	generateTemplateFile
} from '../../../../scripts/build-emails';

type LegalSlots = Record<'brandName' | 'companyName' | 'address', string>;

/** Splits a module written by scripts/build-emails.ts into its HTML and text literals. */
function splitTemplate(content: string) {
	const match = /^([\s\S]*?_HTML = `)([\s\S]*)(`;\n\nexport const \w+_TEXT = `)([\s\S]*)`;\n$/.exec(
		content
	);
	if (!match) throw new Error('Unexpected generated template layout');
	const [, head = '', html = '', separator = '', text = ''] = match;
	return { head, html, separator, text };
}

/**
 * The footer bakes the build's calendar year into the generated files, so their build year is
 * the year the builder last wrote them, not the year the tests run in.
 */
function generatedYear(): number {
	return statSync(join(process.cwd(), 'src/lib/emails/generated/index.ts')).mtime.getFullYear();
}

/**
 * Setup writes each project's brand, company, and address into LEGAL_CONFIG, and the
 * email header and footer render them. The snapshots pin the markup around those values
 * rather than the values themselves, so a configured project matches the template's
 * snapshots. Each value is replaced only at the slot that owns it, after checking that the
 * slot renders exactly that value, so a slot showing the wrong field still fails. The
 * copyright year gets the same treatment against the build year, so the snapshots survive
 * New Year. The plain-text export wraps at 80 columns, so whitespace inside those text slots
 * is collapsed.
 */
function withLegalPlaceholders(
	content: string,
	identity: LegalSlots = LEGAL_CONFIG,
	year = generatedYear()
): string {
	const { head, html, separator, text } = splitTemplate(content);
	const attribute = (key: keyof LegalSlots) =>
		escapeTemplateLiteral(serializeAttribute(identity[key]));
	const element = (key: keyof LegalSlots) => escapeTemplateLiteral(serializeText(identity[key]));
	let normalizedHtml = html;
	for (const [pattern, expected, placeholder] of [
		[
			/(<img alt=")([^"]*)( Logo" src="\{\{baseUrl\}\}\/logo-email\.png")/g,
			attribute('brandName'),
			'[brandName]'
		],
		[/(class="dark_text-zinc-50"><!---->)([^<]*)(<!---->)/g, element('brandName'), '[brandName]'],
		[
			/(<a href="\{\{baseUrl\}\}\/"[^>]*><!---->)([^<]*)(<!----><\/a><!----> All rights reserved\.)/g,
			element('companyName'),
			'[companyName]'
		],
		[/(All rights reserved\.<\/p> <p [^>]*>)([^<]*)(<\/p>)/g, element('address'), '[address]'],
		[/(>Copyright © )([^ <]*)( <a href="\{\{baseUrl\}\}\/")/g, String(year), '[year]']
	] as const) {
		normalizedHtml = replaceSlot(normalizedHtml, pattern, expected, placeholder);
	}

	const paragraphs = text.split('\n\n');
	const plain = (key: keyof LegalSlots) => collapse(escapeTemplateLiteral(identity[key]));
	// html-to-text drops an empty header paragraph and keeps an empty trailing one.
	if (plain('brandName') === '') paragraphs.unshift('');
	expectSlot(collapse(paragraphs[0] ?? ''), plain('brandName'), '[brandName]');
	paragraphs[0] = '[brandName]';
	expectSlot(collapse(paragraphs.at(-1) ?? ''), plain('address'), '[address]');
	paragraphs[paragraphs.length - 1] = '[address]';
	const copyright = paragraphs.findIndex((paragraph) => paragraph.startsWith('Copyright © '));
	// An empty link text makes html-to-text print the bare URL instead of `name [url]`.
	const [, renderedYear, company = ''] =
		/^Copyright © (\S*) (?:(.*) \[\{\{baseUrl\}\}\/\]|\{\{baseUrl\}\}\/) All rights reserved\.$/.exec(
			collapse(paragraphs[copyright] ?? '')
		) ?? [];
	expectSlot(
		renderedYear === undefined ? undefined : company,
		plain('companyName'),
		'[companyName]'
	);
	expectSlot(renderedYear, String(year), '[year]');
	paragraphs[copyright] = 'Copyright © [year] [companyName] [{{baseUrl}}/] All rights reserved.';

	return `${head}${normalizedHtml}${separator}${paragraphs.join('\n\n')}\`;\n`;
}

function replaceSlot(source: string, pattern: RegExp, expected: string, placeholder: string) {
	const matches = [...source.matchAll(pattern)];
	const match = matches[0];
	if (matches.length !== 1 || !match) {
		throw new Error(`Expected one ${placeholder} slot, found ${matches.length}`);
	}
	const [slot, before = '', value, after = ''] = match;
	expectSlot(value, expected, placeholder);
	const start = match.index;
	return source.slice(0, start) + before + placeholder + after + source.slice(start + slot.length);
}

function expectSlot(value: string | undefined, expected: string, placeholder: string) {
	if (value !== expected) {
		throw new Error(
			`${placeholder} slot renders ${JSON.stringify(value)}, expected ${JSON.stringify(expected)}`
		);
	}
}

function collapse(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'\u00a0': '&nbsp;',
	'"': '&quot;',
	'<': '&lt;',
	'>': '&gt;'
};

/**
 * The renderer's final HTML comes from parse5's serializer, which escapes `&`, `"`, and
 * no-break spaces in attribute values but leaves `<` and `>` as they are.
 */
function serializeAttribute(value: string): string {
	return value.replace(/[&\u00a0"]/g, (char) => HTML_ESCAPES[char]!);
}

/** parse5 escapes `&`, `<`, `>`, and no-break spaces in text, but not `"`. */
function serializeText(value: string): string {
	return value.replace(/[&\u00a0<>]/g, (char) => HTML_ESCAPES[char]!);
}

/**
 * Rebuilds a generated template for another identity the way scripts/build-emails.ts does:
 * the header and footer slots take the given values, and the plain text is converted anew
 * from the marker form the builder converts, since marker length affects line wrapping.
 * `headerText` lets a test render a different field in the visible header brand slot.
 */
function renderForIdentity(
	content: string,
	identity: LegalSlots,
	year = generatedYear(),
	headerText = identity.brandName
) {
	const { head, html, separator } = splitTemplate(withLegalPlaceholders(content));
	const rendered = html
		.replace(/\\(\\|`|\$(?=\{))/g, '$1')
		.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
			name === 'baseUrl' ? '__BASEURL__' : `__ETA_${name}__`
		)
		.replace('alt="[brandName] Logo"', () => `alt="${serializeAttribute(identity.brandName)} Logo"`)
		.replace('<!---->[brandName]<!---->', () => `<!---->${serializeText(headerText)}<!---->`)
		.replace(
			'<!---->[companyName]<!---->',
			() => `<!---->${serializeText(identity.companyName)}<!---->`
		)
		.replace('>[address]</p>', () => `>${serializeText(identity.address)}</p>`)
		.replace('>Copyright © [year] ', () => `>Copyright © ${year} `);
	const toTemplate = (value: string) => escapeTemplateLiteral(convertMarkersToTemplate(value));
	return `${head}${toTemplate(rendered)}${separator}${toTemplate(toPlainText(rendered))}\`;\n`;
}

/**
 * Builds the snapshot templates for an identity the way `bun run build:emails` does: the
 * builder's Vite server renders the Svelte components through the repository renderer, and
 * the builder's own functions convert markers and write the module. The served LEGAL_CONFIG
 * is changed only in that server's memory and restored afterwards. `year` fakes the clock the
 * footer reads its copyright year from.
 */
async function buildForIdentity(
	vite: ViteDevServer,
	identity: LegalSlots,
	files: string[],
	year: number
) {
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
		const built: Record<string, string> = {};
		for (const [name, { outputName, props }] of Object.entries(EMAIL_TEMPLATES)) {
			if (!files.includes(`${outputName}.ts`)) continue;
			const component = (
				(await vite.ssrLoadModule(`/src/lib/emails/templates/${name}.svelte`)) as {
					default: unknown;
				}
			).default;
			const rawHtml = await renderer.render(component, { props });
			built[`${outputName}.ts`] = generateTemplateFile(
				outputName,
				convertMarkersToTemplate(rawHtml),
				convertMarkersToTemplate(server.toPlainText(rawHtml))
			);
		}
		return built;
	} finally {
		vi.useRealTimers();
		Object.assign(served, original);
	}
}

/**
 * Returns the brace nesting depth of every `prefers-color-scheme` at-rule in a
 * stylesheet. Depth 0 is a flat top-level block, anything deeper is nested
 * inside the selector it styles.
 */
function darkAtRuleDepths(css: string): number[] {
	const depths: number[] = [];
	let depth = 0;
	for (let index = 0; index < css.length; index++) {
		if (css.startsWith('@media', index)) {
			const prelude = css.slice(index, css.indexOf('{', index) + 1);
			if (/prefers-color-scheme\s*:\s*dark/.test(prelude)) depths.push(depth);
		}
		if (css[index] === '{') depth++;
		else if (css[index] === '}') depth--;
	}
	return depths;
}

const compiledDarkUtilityPattern =
	/\.dark_[\w-]+\s*\{\s*@media[^{]*prefers-color-scheme\s*:\s*dark/;

describe('Generated Email Templates', () => {
	const generatedDir = join(process.cwd(), 'src/lib/emails/generated');

	// Convex treats nested source files as function entry-point candidates. Keep
	// ignored build output out of that tree so every deployed module has a
	// reconstructible git history.
	it('keeps generated templates outside the Convex function root', () => {
		expect(existsSync(join(process.cwd(), 'src/lib/convex/emails/_generated'))).toBe(false);
	});

	describe('VerificationEmail (Magic Link)', () => {
		it('generates verification template files', () => {
			const filePath = join(generatedDir, 'verification.ts');
			expect(existsSync(filePath)).toBe(true);
		});

		it('contains required HTML export', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			expect(content).toContain('export const VERIFICATION_HTML');
		});

		it('contains required TEXT export', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			expect(content).toContain('export const VERIFICATION_TEXT');
		});

		it('includes placeholders for verificationUrl', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			expect(content).toContain('{{verificationUrl}}');
		});

		it('includes placeholders for localized text props', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			expect(content).toContain('lang="{{lang}}"');
			expect(content).toContain('{{titleText}}');
			expect(content).toContain('{{descriptionText}}');
			expect(content).toContain('{{introText}}');
			expect(content).toContain('{{buttonText}}');
			expect(content).toContain('{{expiryText}}');
			expect(content).toContain('{{disclaimerText}}');
		});

		it('includes placeholders for baseUrl', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			expect(content).toContain('{{baseUrl}}');
		});

		it('matches snapshot structure', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			expect(withLegalPlaceholders(content)).toMatchSnapshot();
		});
	});

	describe('PasswordResetEmail', () => {
		it('generates password reset template files', () => {
			const filePath = join(generatedDir, 'passwordReset.ts');
			expect(existsSync(filePath)).toBe(true);
		});

		it('contains required HTML export', () => {
			const content = readFileSync(join(generatedDir, 'passwordReset.ts'), 'utf-8');
			expect(content).toContain('export const PASSWORDRESET_HTML');
		});

		it('contains required TEXT export', () => {
			const content = readFileSync(join(generatedDir, 'passwordReset.ts'), 'utf-8');
			expect(content).toContain('export const PASSWORDRESET_TEXT');
		});

		it('includes placeholders for resetUrl', () => {
			const content = readFileSync(join(generatedDir, 'passwordReset.ts'), 'utf-8');
			expect(content).toContain('{{resetUrl}}');
		});

		it('includes placeholders for localized text props', () => {
			const content = readFileSync(join(generatedDir, 'passwordReset.ts'), 'utf-8');
			expect(content).toContain('lang="{{lang}}"');
			expect(content).toContain('{{titleText}}');
			expect(content).toContain('{{greetingText}}');
			expect(content).toContain('{{bodyText}}');
			expect(content).toContain('{{buttonText}}');
			expect(content).toContain('{{expiryText}}');
			expect(content).toContain('{{disclaimerText}}');
		});

		it('includes placeholders for baseUrl', () => {
			const content = readFileSync(join(generatedDir, 'passwordReset.ts'), 'utf-8');
			expect(content).toContain('{{baseUrl}}');
		});

		it('matches snapshot structure', () => {
			const content = readFileSync(join(generatedDir, 'passwordReset.ts'), 'utf-8');
			expect(withLegalPlaceholders(content)).toMatchSnapshot();
		});
	});

	describe('AdminReplyNotificationEmail', () => {
		it('generates admin reply template files', () => {
			const filePath = join(generatedDir, 'adminReplyNotification.ts');
			expect(existsSync(filePath)).toBe(true);
		});

		it('contains required HTML export', () => {
			const content = readFileSync(join(generatedDir, 'adminReplyNotification.ts'), 'utf-8');
			expect(content).toContain('export const ADMINREPLYNOTIFICATION_HTML');
		});

		it('contains required TEXT export', () => {
			const content = readFileSync(join(generatedDir, 'adminReplyNotification.ts'), 'utf-8');
			expect(content).toContain('export const ADMINREPLYNOTIFICATION_TEXT');
		});

		it('includes placeholders for localized text props', () => {
			const content = readFileSync(join(generatedDir, 'adminReplyNotification.ts'), 'utf-8');
			expect(content).toContain('lang="{{lang}}"');
			expect(content).toContain('{{titleText}}');
			expect(content).toContain('{{descriptionText}}');
			expect(content).toContain('{{buttonText}}');
			expect(content).toContain('{{replyHintText}}');
			expect(content).toContain('{{footerText}}');
		});

		it('includes placeholders for messagePreview', () => {
			const content = readFileSync(join(generatedDir, 'adminReplyNotification.ts'), 'utf-8');
			expect(content).toContain('{{messagePreview}}');
		});

		it('includes placeholders for deepLink', () => {
			const content = readFileSync(join(generatedDir, 'adminReplyNotification.ts'), 'utf-8');
			expect(content).toContain('{{deepLink}}');
		});

		it('includes placeholders for baseUrl', () => {
			const content = readFileSync(join(generatedDir, 'adminReplyNotification.ts'), 'utf-8');
			expect(content).toContain('{{baseUrl}}');
		});

		it('matches snapshot structure', () => {
			const content = readFileSync(join(generatedDir, 'adminReplyNotification.ts'), 'utf-8');
			expect(withLegalPlaceholders(content)).toMatchSnapshot();
		});
	});

	describe('Legal identity normalization', () => {
		const snapshotFiles = ['verification.ts', 'passwordReset.ts', 'adminReplyNotification.ts'];
		// A project may configure equal brand and company names, so the wrong-field case
		// supplies its own distinct values instead of reading them from LEGAL_CONFIG.
		const distinctIdentity: LegalSlots = {
			brandName: 'Northwind',
			companyName: 'Northwind Holdings Ltd.',
			address: '1 Harbour Road, Portsmouth'
		};

		it.each(snapshotFiles)('%s rebuilds byte-identically for the configured identity', (file) => {
			const content = readFileSync(join(generatedDir, file), 'utf-8');
			expect(renderForIdentity(content, LEGAL_CONFIG)).toBe(content);
		});

		it.each(snapshotFiles)('%s fails when the header renders the company name', (file) => {
			const content = readFileSync(join(generatedDir, file), 'utf-8');
			const swapped = renderForIdentity(
				content,
				distinctIdentity,
				undefined,
				distinctIdentity.companyName
			);
			expect(() => withLegalPlaceholders(swapped, distinctIdentity)).toThrow(
				'[brandName] slot renders'
			);
		});

		it.each(snapshotFiles)('%s normalizes brand "Logo" and an empty company name', (file) => {
			const content = readFileSync(join(generatedDir, file), 'utf-8');
			const identity = { brandName: 'Logo', companyName: '', address: LEGAL_CONFIG.address };
			expect(withLegalPlaceholders(renderForIdentity(content, identity), identity)).toBe(
				withLegalPlaceholders(content)
			);
		});

		describe('against the real renderer', () => {
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
				['equal brand and company', { ...distinctIdentity, companyName: 'Northwind' }, thisYear],
				// The committed snapshots must keep matching after New Year without an update.
				['another calendar year', LEGAL_CONFIG, thisYear + 1]
			])(
				'normalizes and rebuilds the build output for %s',
				async (_, identity, year) => {
					const built = await buildForIdentity(vite!, identity, snapshotFiles, year);
					for (const file of snapshotFiles) {
						const content = readFileSync(join(generatedDir, file), 'utf-8');
						const output = built[file]!;
						expect(withLegalPlaceholders(output, identity, year), file).toBe(
							withLegalPlaceholders(content)
						);
						expect(renderForIdentity(content, identity, year), file).toBe(output);
					}
				},
				60_000
			);
		});
	});

	describe('Index Export', () => {
		it('generates index file', () => {
			const filePath = join(generatedDir, 'index.ts');
			expect(existsSync(filePath)).toBe(true);
		});

		it('exports all template modules', () => {
			const content = readFileSync(join(generatedDir, 'index.ts'), 'utf-8');

			// Check for module exports
			expect(content).toContain("export * from './verification.js'");
			expect(content).toContain("export * from './passwordReset.js'");
			expect(content).toContain("export * from './adminReplyNotification.js'");
		});
	});

	describe('Template Quality', () => {
		it('verification HTML template is not empty', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			const htmlMatch = content.match(/export const VERIFICATION_HTML = `([^`]+)`/s);
			expect(htmlMatch).toBeTruthy();
			expect(htmlMatch![1]!.length).toBeGreaterThan(100);
		});

		it('verification TEXT template is not empty', () => {
			const content = readFileSync(join(generatedDir, 'verification.ts'), 'utf-8');
			const textMatch = content.match(/export const VERIFICATION_TEXT = `([^`]+)`/s);
			expect(textMatch).toBeTruthy();
			expect(textMatch![1]!.length).toBeGreaterThan(50);
		});

		it('templates do not contain raw Svelte syntax', () => {
			const files = ['verification.ts', 'passwordReset.ts', 'adminReplyNotification.ts'];

			files.forEach((file) => {
				const content = readFileSync(join(generatedDir, file), 'utf-8');

				// Should not have Svelte script tags
				expect(content).not.toContain('<script');

				// Should not have Svelte let bindings
				expect(content).not.toContain('let {');
				expect(content).not.toContain('$props()');
			});
		});

		it('templates contain valid HTML structure', () => {
			const files = ['verification.ts', 'passwordReset.ts', 'adminReplyNotification.ts'];

			files.forEach((file) => {
				const content = readFileSync(join(generatedDir, file), 'utf-8');

				// Should have HTML doctype
				expect(content).toContain('<!DOCTYPE');

				// Should have closing html tag
				expect(content).toContain('</html>');

				// Should have head and body
				expect(content).toContain('<head');
				expect(content).toContain('<body');
			});
		});

		it('never leaks the web-only Fontaine fallback family into emails', () => {
			// Fontaine appends an "Outfit fallback" family to the web app's font
			// usages for CLS. Emails build from the same shared font tokens, so a
			// regression that wires that fallback into the --font-* tokens would leak
			// a font family no email client can resolve. Guard the boundary.
			for (const file of readdirSync(generatedDir).filter((f) => f.endsWith('.ts'))) {
				const content = readFileSync(join(generatedDir, file), 'utf-8');
				expect(content, `${file} leaked the web-only fallback family`).not.toMatch(
					/Outfit fallback/
				);
			}
		});
	});

	// Dark mode has two halves that are each easy to drop by accident, and each
	// half fails silently: removing the meta tags keeps Apple Mail on a pure white
	// page, and dropping the renderer's final email-safe `dark` definition lets the
	// app variant compile every dark: utility to an unmatchable `.dark` ancestor.
	// Assert on the rendered output, which is what the mail client sees.
	describe('Dark mode', () => {
		const generatedFiles = Object.values(EMAIL_TEMPLATES).map(
			(config) => `${config.outputName}.ts`
		);

		it.each(generatedFiles)('%s declares both colour-scheme meta tags', (file) => {
			const content = readFileSync(join(generatedDir, file), 'utf-8');

			for (const meta of [
				'name="color-scheme" content="light dark"',
				'name="supported-color-schemes" content="light dark"'
			]) {
				expect(
					content,
					`${file} is missing <meta ${meta}>. Apple Mail never enters dark mode without both colour-scheme meta tags and renders the message pure white instead. Keep them in src/lib/emails/components/layout/EmailHead.svelte.`
				).toContain(meta);
			}
		});

		it.each(generatedFiles)('%s ships nested prefers-color-scheme rules', (file) => {
			const content = readFileSync(join(generatedDir, file), 'utf-8');
			const depths = [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].flatMap((match) =>
				darkAtRuleDepths(match[1]!)
			);

			expect(
				depths.length,
				`${file} has no prefers-color-scheme: dark rule, so it carries the colour-scheme meta tags without matching dark styles, which is worse than no dark mode at all. Keep the final email-safe dark variant definition in renderer.ts.`
			).toBeGreaterThan(0);

			expect(
				depths.filter((depth) => depth === 0),
				`${file} has a flat top-level @media (prefers-color-scheme: dark) block. The shape must stay nested inside its selector, as \`selector { @media (prefers-color-scheme: dark) { ... } }\`: Outlook does not parse CSS nesting and leaves its own inversion alone, where a flat block collapses the card into the surrounding greys.`
			).toEqual([]);
		});

		// The two assertions above are both satisfied by the single hand-written
		// body rule in EmailHead.svelte, so on their own they still pass while every
		// dark: utility silently compiles to an unmatchable `.dark` ancestor and the
		// card stays white on a dark page. These two pin the compiled utilities
		// themselves, which is the half that actually regresses.
		it.each(generatedFiles)('%s compiles dark: utilities to media queries', (file) => {
			const styles = [
				...readFileSync(join(generatedDir, file), 'utf-8').matchAll(
					/<style[^>]*>([\s\S]*?)<\/style>/g
				)
			]
				.map((match) => match[1]!)
				.join('\n');

			expect(
				compiledDarkUtilityPattern.test(styles),
				`${file} carries no compiled dark: utility rule. A dark: class must emit \`.dark_<name> { @media (prefers-color-scheme: dark) { ... } }\`. Keep the final email-safe dark variant definition after the app CSS in renderer.ts.`
			).toBe(true);
		});

		it('does not accept light media queries as dark utility output', () => {
			const lightStyles =
				'.dark_bg-zinc-800 { @media (prefers-color-scheme: light) { background-color: black; } }';

			expect(
				compiledDarkUtilityPattern.test(lightStyles),
				'A compiled dark: utility must explicitly target prefers-color-scheme: dark. A light query does not activate the intended email dark-mode override.'
			).toBe(false);
		});

		it('signup output keeps its template-specific dark surfaces', () => {
			const file = 'newUserSignupNotification.ts';
			const content = readFileSync(join(generatedDir, file), 'utf-8');
			const styles = [...content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
				.map((match) => match[1]!)
				.join('\n');

			expect(
				content,
				`${file} must apply dark:bg-zinc-800 to the signup detail panel. Without that class, the generated detail surface stays light against the dark card even if another element still emits the shared CSS rule.`
			).toMatch(
				/<div class="dark_bg-zinc-800"[^>]*>[\s\S]*?\{\{nameLabel\}\}[\s\S]*?\{\{signupTime\}\}[\s\S]*?<\/div>/
			);
			expect(
				styles,
				`${file} must compile dark:bg-zinc-800 as a nested dark media rule with background-color rgb(39, 39, 42). Otherwise the signup detail panel keeps its light background in dark mode.`
			).toMatch(
				/\.dark_bg-zinc-800\s*\{\s*@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{\s*background-color:\s*rgb\(39,\s*39,\s*42\)\s*!important;/
			);

			expect(
				content,
				`${file} must apply dark:bg-blue-600 and dark:text-white together to the signup badge. These explicit overrides keep client dark-mode inversion from washing out the blue badge or reducing its text contrast.`
			).toMatch(/<span data-slot="badge" class="dark_bg-blue-600 dark_text-white"/);
			expect(
				styles,
				`${file} must compile dark:bg-blue-600 as a nested dark media rule with background-color rgb(21, 93, 252). The explicit blue override prevents client inversion from changing the signup badge colour.`
			).toMatch(
				/\.dark_bg-blue-600\s*\{\s*@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{\s*background-color:\s*rgb\(21,\s*93,\s*252\)\s*!important;/
			);
			expect(
				styles,
				`${file} must compile dark:text-white as a nested dark media rule with color rgb(255, 255, 255). The explicit white override preserves readable signup badge text after client inversion.`
			).toMatch(
				/\.dark_text-white\s*\{\s*@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{\s*color:\s*rgb\(255,\s*255,\s*255\)\s*!important;/
			);
		});

		it.each(generatedFiles)('%s has no unmatchable .dark ancestor selector', (file) => {
			const styles = [
				...readFileSync(join(generatedDir, file), 'utf-8').matchAll(
					/<style[^>]*>([\s\S]*?)<\/style>/g
				)
			]
				.map((match) => match[1]!)
				.join('\n');

			expect(
				styles,
				`${file} styles a \`.dark\` ancestor, which no mail client ever renders, so every dark: utility is dead. Keep the email-safe \`@custom-variant dark\` definition after the app CSS in renderer.ts so Tailwind uses it last.`
			).not.toMatch(/\.dark\s*\*|:is\(\.dark\b/);
		});
	});
});
