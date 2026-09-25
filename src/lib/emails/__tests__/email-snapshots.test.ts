import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EMAIL_TEMPLATES } from '../templates/registry';
import { toPlainText } from '@better-svelte-email/server';
import { LEGAL_CONFIG } from '$lib/config/legal';

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
 * Setup writes each project's brand, company, and address into LEGAL_CONFIG, and the
 * email header and footer render them. The snapshots pin the markup around those values
 * rather than the values themselves, so a configured project matches the template's
 * snapshots. Each value is replaced only at the slot that owns it, after checking that the
 * slot renders exactly that value, so a slot showing the wrong field still fails. The
 * plain-text export wraps at 80 columns, so whitespace inside those text slots is collapsed.
 */
function withLegalPlaceholders(content: string, identity: LegalSlots = LEGAL_CONFIG): string {
	const { head, html, separator, text } = splitTemplate(content);
	const attribute = (key: keyof LegalSlots) =>
		escapeTemplateLiteral(escapeHtml(identity[key], /[&"<]/g));
	const element = (key: keyof LegalSlots) =>
		escapeTemplateLiteral(escapeHtml(identity[key], /[&<]/g));
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
		[/(All rights reserved\.<\/p> <p [^>]*>)([^<]*)(<\/p>)/g, element('address'), '[address]']
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
	const [, year, company = ''] =
		/^Copyright © (\d{4}) (?:(.*) \[\{\{baseUrl\}\}\/\]|\{\{baseUrl\}\}\/) All rights reserved\.$/.exec(
			collapse(paragraphs[copyright] ?? '')
		) ?? [];
	expectSlot(year === undefined ? undefined : company, plain('companyName'), '[companyName]');
	paragraphs[copyright] = `Copyright © ${year} [companyName] [{{baseUrl}}/] All rights reserved.`;

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

function escapeHtml(value: string, pattern: RegExp): string {
	return value.replace(pattern, (char) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;' })[char]!);
}

/** Mirrors `escapeTemplateLiteral` in scripts/build-emails.ts. */
function escapeTemplateLiteral(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/**
 * Rebuilds a generated template for another identity the way scripts/build-emails.ts does:
 * the header and footer slots take the given values, and the plain text is converted anew
 * from the marker form the builder converts, since marker length affects line wrapping.
 * `headerText` lets a test render a different field in the visible header brand slot.
 */
function renderForIdentity(content: string, identity: LegalSlots, headerText = identity.brandName) {
	const { head, html, separator } = splitTemplate(withLegalPlaceholders(content));
	const rendered = html
		.replace(/\\(\\|`|\$(?=\{))/g, '$1')
		.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
			name === 'baseUrl' ? '__BASEURL__' : `__ETA_${name}__`
		)
		.replace(
			'alt="[brandName] Logo"',
			() => `alt="${escapeHtml(identity.brandName, /[&"<]/g)} Logo"`
		)
		.replace('<!---->[brandName]<!---->', () => `<!---->${escapeHtml(headerText, /[&<]/g)}<!---->`)
		.replace(
			'<!---->[companyName]<!---->',
			() => `<!---->${escapeHtml(identity.companyName, /[&<]/g)}<!---->`
		)
		.replace('>[address]</p>', () => `>${escapeHtml(identity.address, /[&<]/g)}</p>`);
	const toTemplate = (value: string) =>
		escapeTemplateLiteral(
			value.replace(/__ETA_(\w+)__/g, '{{$1}}').replace(/__BASEURL__/g, '{{baseUrl}}')
		);
	return `${head}${toTemplate(rendered)}${separator}${toTemplate(toPlainText(rendered))}\`;\n`;
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

		it.each(snapshotFiles)('%s rebuilds byte-identically for the configured identity', (file) => {
			const content = readFileSync(join(generatedDir, file), 'utf-8');
			expect(renderForIdentity(content, LEGAL_CONFIG)).toBe(content);
		});

		it.each(snapshotFiles)('%s fails when the header renders the company name', (file) => {
			const content = readFileSync(join(generatedDir, file), 'utf-8');
			const swapped = renderForIdentity(content, LEGAL_CONFIG, LEGAL_CONFIG.companyName);
			expect(() => withLegalPlaceholders(swapped)).toThrow('[brandName] slot renders');
		});

		it.each(snapshotFiles)('%s normalizes brand "Logo" and an empty company name', (file) => {
			const content = readFileSync(join(generatedDir, file), 'utf-8');
			const identity = { brandName: 'Logo', companyName: '', address: LEGAL_CONFIG.address };
			expect(withLegalPlaceholders(renderForIdentity(content, identity), identity)).toBe(
				withLegalPlaceholders(content)
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
