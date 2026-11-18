// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ESLint } from 'eslint';
import stripAnsi from 'strip-ansi';
import type * as TypeScript from 'typescript';
import { describe, expect, it } from 'vitest';
import { sharedTestSettings } from '../scripts/vitest-settings';
import { CUSTOM_REGISTRARS } from './convex-registrars.js';

/**
 * What `no-literal-control-char` can actually see.
 *
 * The rule replaced a scan in `scripts/static-checks.ts` whose route required a
 * `src/` prefix, so it reached neither `scripts/` nor the config files nor itself.
 * That claim is the whole reason the rule lives in ESLint, and a config calculation
 * alone cannot prove it: a file-wide `/* eslint-disable *\/` still suppresses a rule
 * whose calculated severity is `error`.
 *
 * Each positive case therefore reads an existing tracked file, adds a control
 * character in a valid comment, and sends the result through the real ESLint API
 * with that file's path. This covers config selection, parsers, processors, inline
 * directives, and the final rule verdict in one assertion.
 *
 * Convex codegen and varlock's Convex generator write a file-wide disable into their
 * output, so those paths stay globally ignored. `src/varlock-env.d.ts` gets different
 * treatment: its processor blanks that directive without shifting source locations,
 * because environment values come from outside the repository and are exactly where
 * a character nobody typed can enter generated source.
 */
const eslint = new ESLint();
const offender = String.fromCharCode(0x1b);

describe('Svelte type-aware linting', () => {
	it('recognizes stores through imported types', async () => {
		const [result] = await eslint.lintText(
			`<script lang="ts">
				import type { Readable } from 'svelte/store';
				let { value }: { value: Readable<string> } = $props();
			</script>
			<p>{value}</p>`,
			{ filePath: 'src/routes/+layout.svelte' }
		);
		expect(result.messages.filter((message) => message.fatal)).toEqual([]);
		expect(
			result.messages.filter((message) => message.ruleId === 'svelte/require-store-reactive-access')
		).toHaveLength(1);
	}, 60_000);

	it('accepts a resolved link through its imported type', async () => {
		const [result] = await eslint.lintText(
			`<script lang="ts">
				import type { ResolvedPathname } from '$app/types';
				let { href }: { href: ResolvedPathname } = $props();
			</script>
			<a {href}>Link</a>`,
			{ filePath: 'src/routes/+layout.svelte' }
		);
		expect(result.messages.filter((message) => message.fatal)).toEqual([]);
		expect(
			result.messages.filter((message) => message.ruleId === 'svelte/no-navigation-without-resolve')
		).toEqual([]);
	}, 60_000);

	// The plugin gates this rule on the installed SvelteKit major and skips it
	// silently outside the versions it lists, so only an unresolved link proves
	// it still runs.
	it('reports an unresolved link and navigation call', async () => {
		const [result] = await eslint.lintText(
			`<script lang="ts">
				import { goto } from '$app/navigation';
				void goto('/en/app');
			</script>
			<a href="/en/app">Link</a>`,
			{ filePath: 'src/routes/+layout.svelte' }
		);
		expect(result.messages.filter((message) => message.fatal)).toEqual([]);
		expect(
			result.messages
				.filter((message) => message.ruleId === 'svelte/no-navigation-without-resolve')
				.map((message) => message.line)
		).toEqual([3, 5]);
	}, 60_000);

	// When TypeScript reads raw markup for a Svelte file, typescript-eslint rebuilds its
	// program for every Svelte file it lints, which multiplies a full run's lint time.
	// The component lives under tmpdir() because a tracked .svelte file outside every
	// tsconfig fails type-aware linting.
	it('lets the type checker read Svelte files as TypeScript', async () => {
		const markup =
			'<script lang="ts">\n\tlet { label }: { label: string } = $props();\n</script>\n\n<p>{label}</p>\n';
		const directory = mkdtempSync(path.join(tmpdir(), 'ts-sys-hook-'));
		const component = path.join(directory, 'component.svelte');
		try {
			writeFileSync(component, markup);
			// The real path selects the type-aware Svelte config that installs the hook.
			await eslint.lintText(markup, { filePath: 'src/routes/+layout.svelte' });
			const ts: typeof TypeScript = createRequire(import.meta.url)('typescript');
			expect(ts.sys.readFile(component)).not.toBe(markup);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 60_000);
});

async function controlCharacterMessages(file: string) {
	// Keep the real path, which selects the config, parser and processor. A minimal
	// source makes this a coverage test rather than a second lint of six whole files.
	// The generated env case deliberately keeps its real header, because its file-wide
	// disable is the condition the processor exists to remove.
	const source =
		file === 'src/varlock-env.d.ts'
			? readFileSync(file, 'utf-8')
			: file.endsWith('.svelte')
				? '<script>const value = true;</script>'
				: 'export {};';
	const withOffender = file.endsWith('.svelte')
		? `${source}\n<!-- ${offender} -->\n`
		: `${source}\n// ${offender}\n`;
	const [result] = await eslint.lintText(withOffender, { filePath: file });
	return result.messages.filter((message) => message.ruleId === 'local/no-literal-control-char');
}

describe('no-literal-control-char coverage', () => {
	it.each([
		['a source module', 'src/lib/utils.ts'],
		['a Svelte component', 'src/routes/+layout.svelte'],
		['a build script outside src/', 'scripts/static-checks.ts'],
		['the ESLint config itself', 'eslint.config.js'],
		['the rule implementation', 'packages/eslint-plugin/src/rules/no-literal-control-char.js'],
		['the generated env types despite their file-wide disable', 'src/varlock-env.d.ts']
	])(
		'reaches %s',
		async (_label, file) => {
			expect(existsSync(file)).toBe(true);
			const messages = await controlCharacterMessages(file);
			expect(messages).toHaveLength(1);
			expect(messages[0].severity).toBe(2);
		},
		60_000
	);

	it.each([
		['C0', 0x1b, 'U+001B'],
		['DEL', 0x7f, 'U+007F'],
		['C1', 0x85, 'U+0085'],
		['bidi', 0x202e, 'U+202E']
	])(
		'sanitizes a fatal Svelte parser diagnostic carrying %s input',
		async (_label, code, codepoint) => {
			const value = String.fromCharCode(code);
			const source = `<div>{${value}}</div>`;
			const [result] = await eslint.lintText(source, { filePath: 'src/routes/+layout.svelte' });
			const fatal = result.messages.filter((message) => message.fatal);
			expect(fatal).toHaveLength(1);
			expect(fatal[0].message).toContain(codepoint);
			expect(fatal[0].message).not.toContain(value);
			const formatter = await eslint.loadFormatter('stylish');
			expect(stripAnsi(await formatter.format([result]))).not.toContain(value);
		},
		60_000
	);

	it('keeps ordinary Svelte rule suppression on the valid parse path', async () => {
		const source = `<!-- eslint-disable local/no-literal-control-char -->
<!-- ${offender} -->`;
		const [result] = await eslint.lintText(source, { filePath: 'src/routes/+layout.svelte' });
		expect(
			result.messages.filter((message) => message.ruleId === 'local/no-literal-control-char')
		).toEqual([]);
	}, 60_000);

	// The generators for these paths disable ESLint inside every file. Un-ignoring
	// them would buy no coverage and add only unused-directive warnings.
	it.each([
		['Convex codegen output', 'src/lib/convex/_generated/api.js'],
		['the varlock Convex env types', 'src/lib/convex/convex-env.d.ts']
	])(
		'leaves %s ignored, because its generator disables ESLint inside the file',
		async (_label, file) => {
			expect(await eslint.isPathIgnored(file)).toBe(true);
		}
	);
});

describe('generated English policy bundle linting', () => {
	it('ignores the bundle without hiding authored policy source', async () => {
		const generatedBundle = 'scripts/english-policy/pr-metadata.bundle.mjs';
		const authoredSource = 'scripts/english-policy/pr-metadata.ts';
		const oxlintConfig = JSON.parse(readFileSync('.oxlintrc.json', 'utf8')) as {
			ignorePatterns: string[];
		};

		expect(await eslint.isPathIgnored(generatedBundle)).toBe(true);
		expect(await eslint.isPathIgnored(authoredSource)).toBe(false);
		expect(
			oxlintConfig.ignorePatterns.filter((pattern) => pattern.startsWith('scripts/english-policy/'))
		).toEqual([generatedBundle]);
	});
});

describe('create-saas-starter tool coverage', () => {
	it('separates app and creator TypeScript and Vitest projects without hiding source', async () => {
		const rootTsconfig = readFileSync('tsconfig.json', 'utf8');
		const oxlintConfig = JSON.parse(readFileSync('.oxlintrc.json', 'utf8')) as {
			ignorePatterns: string[];
		};

		expect(rootTsconfig).toContain('"packages/create-saas-starter/**"');
		expect(sharedTestSettings.exclude).toContain('packages/create-saas-starter/test/**');
		expect(await eslint.isPathIgnored('packages/create-saas-starter/src/index.ts')).toBe(false);
		expect(
			oxlintConfig.ignorePatterns.some((pattern) => pattern.includes('create-saas-starter'))
		).toBe(false);
	});
});

async function rawCaughtErrorMessages(file: string, log = "console.error('[run] failed:', error)") {
	// The real path selects the config block; the snippet stands in for the file.
	const source = `export async function run(load: () => Promise<void>) {
	try {
		await load();
	} catch (error) {
		${log};
	}
}
`;
	const [result] = await eslint.lintText(source, { filePath: file });
	expect(result.messages.filter((message) => message.fatal)).toEqual([]);
	return result.messages.filter((message) => message.ruleId === 'local/no-raw-caught-error-log');
}

describe('no-raw-caught-error-log coverage', () => {
	it.each([
		['the server hooks', 'src/hooks.server.ts'],
		['a page load', 'src/routes/[[lang]]/(auth)/signin/+page.server.ts'],
		['an endpoint', 'src/routes/api/auth/[...all]/+server.ts'],
		['a remote function module', 'src/routes/[[lang]]/admin/settings/data.remote.ts'],
		['a server module', 'src/lib/server/auth-proxy.ts']
	])(
		'reaches %s',
		async (_label, file) => {
			expect(existsSync(file)).toBe(true);
			const messages = await rawCaughtErrorMessages(file);
			expect(messages).toHaveLength(1);
			expect(messages[0].severity).toBe(2);
		},
		60_000
	);

	it('sees through a cast around the caught error', async () => {
		const messages = await rawCaughtErrorMessages(
			'src/lib/server/auth-proxy.ts',
			'console.error(<Error>error)'
		);
		expect(messages).toHaveLength(1);
	}, 60_000);

	it.each([
		['shared code that also runs in the browser', 'src/lib/utils/convex-errors.ts'],
		['Convex functions, which log to the Convex dashboard', 'src/lib/convex/users.ts'],
		['a test', 'src/lib/server/auth-proxy.test.ts']
	])(
		'leaves out %s',
		async (_label, file) => {
			expect(existsSync(file)).toBe(true);
			expect(await rawCaughtErrorMessages(file)).toEqual([]);
		},
		60_000
	);
});

describe('no-networkidle-wait through the flat config', () => {
	const ruleId = 'local/no-networkidle-wait';
	const source = `
		import { test } from '@playwright/test';
		test('ready', async ({ page }) => {
			// page.waitForLoadState('networkidle') in a comment is fine.
			await page.goto('/en/pricing', { waitUntil: 'networkidle' });
			await page.waitForLoadState('networkidle');
			await page.setContent('<main>Ready</main>', { waitUntil: 'networkidle' });
		});
	`;

	async function ruleLines(text: string, filePath: string) {
		const [result] = await eslint.lintText(text, { filePath });
		expect(result.fatalErrorCount).toBe(0);
		return result.messages
			.filter((message) => message.ruleId === ruleId)
			.map((message) => [message.line, message.severity]);
	}

	it.each(['e2e/example.spec.ts', 'e2e/utils/readiness.ts'])(
		'reports both calls in %s as errors',
		async (filePath) => {
			expect(await ruleLines(source, filePath)).toEqual([
				[5, 2],
				[6, 2],
				[7, 2]
			]);
		},
		60_000
	);

	it('accepts an exception with an inline reason', async () => {
		const excepted = `
			// eslint-disable-next-line local/no-networkidle-wait -- asserts that no request follows the opt-out
			await page.waitForLoadState('networkidle');
		`;
		expect(await ruleLines(excepted, 'e2e/example.spec.ts')).toEqual([]);
	}, 60_000);

	it('leaves application code alone', async () => {
		expect(await ruleLines(source, 'src/lib/example.ts')).toEqual([]);
	}, 60_000);
});

describe('project options of the workspace rules', () => {
	async function ruleIds(text: string, filePath: string) {
		const [result] = await eslint.lintText(text, { filePath });
		expect(result.fatalErrorCount).toBe(0);
		return result.messages.map((message) => message.ruleId);
	}

	it.each(CUSTOM_REGISTRARS)(
		'checks %s registrations for returns and args validators',
		async (builder) => {
			const ids = await ruleIds(
				`export const f = ${builder}({ handler: async () => null });`,
				'src/lib/convex/users.ts'
			);
			expect(ids).toContain('local/require-returns-validator');
			expect(ids).toContain('local/require-custom-registrar-args');
		},
		60_000
	);

	it('resolves #lib/ rune module imports from src/lib', async () => {
		expect(
			await ruleIds(`export { haptic } from '#lib/hooks/use-haptic.svelte.js';`, 'src/lib/utils.ts')
		).toContain('local/require-svelte-module-extension');
	}, 60_000);
});
