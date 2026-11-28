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

// The first type-aware Svelte lint loads the config and builds the TypeScript program of the
// whole app, which no test timeout can bound under load; every later Svelte lint reuses that
// program. A top-level await builds it while Vitest collects the file, without a timeout.
await eslint.lintText('<script lang="ts"></script>', { filePath: 'src/routes/+layout.svelte' });

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
		['the varlock Convex env types', 'src/lib/confect/convex-env.d.ts']
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
		['Convex functions, which log to the Convex dashboard', 'src/lib/confect/users.impl.ts'],
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

	it('resolves #lib/ rune module imports from src/lib', async () => {
		expect(
			await ruleIds(`export { haptic } from '#lib/hooks/use-haptic.svelte.js';`, 'src/lib/utils.ts')
		).toContain('local/require-svelte-module-extension');
	}, 60_000);
});

describe('registration ratchet through the flat config', () => {
	async function ratchetReports(text: string, filePath: string) {
		const [result] = await eslint.lintText(text, { filePath });
		expect(result.fatalErrorCount).toBe(0);
		return result.messages
			.filter((message) => message.ruleId === 'local/convex-canonical-registration')
			.map((message) => message.messageId);
	}

	it('refuses a plain spec built from a constructor subpath', async () => {
		expect(
			await ratchetReports(
				`import * as FunctionSpec from '@confect/core/FunctionSpec';
				import { GroupSpec } from '@confect/core';
				import type { attach } from './autumn';
				export default GroupSpec.make().addFunction(FunctionSpec.convexPublicAction<typeof attach>()('attach'));`,
				'src/lib/confect/probe.spec.ts'
			)
		).toEqual(['constructorSubpath']);
	}, 60_000);

	it('refuses a constructor barrel and the spec that imports from it', async () => {
		expect(
			await ratchetReports(
				`export { FunctionSpec, GroupSpec } from '@confect/core';`,
				'src/lib/confect/constructors.ts'
			)
		).toEqual(['reexport', 'reexport']);
		expect(
			await ratchetReports(
				`import { FunctionSpec, GroupSpec } from './constructors';
				import type { attach } from './autumn';
				export default GroupSpec.make().addFunction(FunctionSpec.convexPublicAction<typeof attach>()('attach'));`,
				'src/lib/confect/probe.spec.ts'
			)
		).toEqual(['constructorSubpath', 'constructorSubpath']);
	}, 60_000);

	it('refuses an application import of a plain handler from a test path', async () => {
		const helper = `import { httpActionGeneric } from 'convex/server';
			export const plainHandler = httpActionGeneric(async () => new Response(null));`;
		expect(await ratchetReports(helper, 'src/lib/confect/__tests__/plainRoute.ts')).toEqual([]);
		expect(
			await ratchetReports(
				`import { httpRouter } from 'convex/server';
				import { plainHandler } from './__tests__/plainRoute';
				const http = httpRouter();
				http.route({ path: '/other', method: 'POST', handler: plainHandler });
				export default http;`,
				'src/lib/confect/http.ts'
			)
		).toEqual(['testModuleImport']);
	}, 60_000);

	it('refuses a listed route registered through a forwarding helper', async () => {
		expect(
			await ratchetReports(
				`import { httpRouter } from 'convex/server';
				import { httpAction } from '../convex/_generated/server';
				const http = httpRouter();
				const nested = { route(config: { path: string; method: 'POST'; handler: ReturnType<typeof httpAction> }) { http.route({ ...config, path: '/other' }); } };
				nested.route({ path: '/resend-webhook', method: 'POST', handler: httpAction(async () => new Response(null)) });
				export default http;`,
				'src/lib/confect/http.ts'
			)
		).toEqual(['unlistedHttpRoute']);
	}, 60_000);

	it('refuses a library group forwarded under another group name', async () => {
		expect(
			await ratchetReports(
				`export { sub as default } from './autumn.spec';`,
				'src/lib/confect/probe.spec.ts'
			)
		).toEqual(['specForwarding']);
		expect(
			await ratchetReports(
				`import { FunctionImpl, GroupImpl } from '@confect/server';
				import * as Layer from 'effect/Layer';
				import databaseSchema from './_generated/schema';
				import probe from './probe.spec';
				import { sub } from './autumn.spec';
				import { attach } from './autumn';
				export default GroupImpl.make(databaseSchema, probe).pipe(
					Layer.provide(FunctionImpl.make(databaseSchema, sub, 'attach', attach)),
					GroupImpl.finalize
				);`,
				'src/lib/confect/probe.impl.ts'
			)
		).toEqual(['inlineImplementation']);
	}, 60_000);

	it('refuses a constructor exported under another name and its two-barrel chain', async () => {
		const chain: Array<[string, string]> = [
			[
				`import { FunctionSpec } from '@confect/core';
				import { FunctionImpl } from '@confect/server';
				export { FunctionSpec as FS, FunctionImpl as FI };`,
				'src/lib/convex-components/constructors.ts'
			],
			[`export { FS, FI } from './constructors';`, 'src/lib/convex-components/constructors2.ts'],
			[
				`import { FS } from '../convex-components/constructors2';
				import { GroupSpec } from '@confect/core';
				import type { attach } from './autumn';
				export default GroupSpec.make().addFunction(FS.convexPublicAction<typeof attach>()('attach'));`,
				'src/lib/confect/probe.spec.ts'
			],
			[
				`import { FI } from '../convex-components/constructors2';
				import { GroupImpl } from '@confect/server';
				import * as Layer from 'effect/Layer';
				import databaseSchema from './_generated/schema';
				import probe from './probe.spec';
				import { attach } from './autumn';
				export default GroupImpl.make(databaseSchema, probe).pipe(
					Layer.provide(FI.make(databaseSchema, probe, 'attach', attach)),
					GroupImpl.finalize
				);`,
				'src/lib/confect/probe.impl.ts'
			]
		];
		const reports: Array<string | undefined> = [];
		for (const [text, filePath] of chain) reports.push(...(await ratchetReports(text, filePath)));
		expect(reports).toEqual(['indirectReference', 'indirectReference']);
		expect(
			await ratchetReports(
				`import { FunctionSpec } from '@confect/core';
				export default FunctionSpec;`,
				'src/lib/convex-components/constructors.ts'
			)
		).toEqual(['indirectReference']);
	}, 60_000);

	it('refuses a raw builder in a helper outside the Convex directories', async () => {
		expect(
			await ratchetReports(
				`import { httpActionGeneric } from 'convex/server';
				export const plainHandler = httpActionGeneric(async () => new Response(null));`,
				'src/lib/http/plainRoute.ts'
			)
		).toContain('plainRegistration');
	}, 60_000);

	it('refuses a barrel outside the Convex directories that re-exports a test helper', async () => {
		expect(
			await ratchetReports(
				`export { plainHandler } from '../confect/__tests__/plainRoute';`,
				'src/lib/http/plainRoute.ts'
			)
		).toEqual(['testModuleImport']);
	}, 60_000);
});

describe('schema library imports through the flat config', () => {
	async function restrictedImports(text: string, filePath: string) {
		const [result] = await eslint.lintText(text, { filePath });
		expect(result.fatalErrorCount).toBe(0);
		return result.messages
			.filter((message) => message.ruleId === 'no-restricted-imports')
			.map((message) => message.message);
	}

	it.each([
		["import * as val from 'valibot';", 'src/lib/confect/support/threads.impl.ts'],
		["import { z } from 'zod';", 'src/lib/confect/aiChat/tools/weather.ts'],
		["import { z } from 'zod/v4';", 'src/lib/convex-components/betterAuth/seedUser.ts'],
		["import * as val from 'valibot';", 'src/lib/convex/probe.test.ts']
	])(
		'refuses %s in %s',
		async (text, filePath) => {
			expect(await restrictedImports(text, filePath)).toEqual([
				expect.stringContaining('Convex code validates with effect/Schema.')
			]);
		},
		60_000
	);

	it.each([
		['src/lib/confect/admin/types.ts'],
		['src/lib/schemas/auth.ts'],
		['src/routes/[[lang]]/(auth)/signin/schema.ts']
	])(
		'leaves valibot open in %s',
		async (filePath) => {
			expect(await restrictedImports("import * as val from 'valibot';", filePath)).toEqual([]);
		},
		60_000
	);

	it('keeps the fontless/runtime restriction in Convex code', async () => {
		expect(
			await restrictedImports(
				"import 'fontless/runtime';",
				'src/lib/confect/support/threads.impl.ts'
			)
		).toEqual([
			expect.stringContaining('Import fontless/runtime only in src/routes/+layout.svelte.')
		]);
	}, 60_000);
});

describe('Web Storage access through the flat config', () => {
	async function storageReports(text: string, filePath: string) {
		const [result] = await eslint.lintText(text, { filePath });
		expect(result.fatalErrorCount).toBe(0);
		return result.messages
			.filter(
				(message) =>
					message.ruleId === 'no-restricted-globals' ||
					message.ruleId === '@typescript-eslint/no-restricted-imports'
			)
			.map((message) => [message.ruleId, message.line]);
	}

	const reads = `localStorage.getItem('a');
window.sessionStorage.getItem('b');
self.localStorage.getItem('c');
globalThis.sessionStorage.getItem('d');
`;

	it('refuses every native storage read in application code', async () => {
		expect(await storageReports(reads, 'src/lib/example.ts')).toEqual([
			['no-restricted-globals', 1],
			['no-restricted-globals', 2],
			['no-restricted-globals', 3],
			['no-restricted-globals', 4]
		]);
	}, 60_000);

	it('refuses a storage read in a component', async () => {
		const component = `<script lang="ts">
	const stored = window.localStorage.getItem('key');
</script>
<p>{stored}</p>`;
		expect(await storageReports(component, 'src/routes/+layout.svelte')).toEqual([
			['no-restricted-globals', 2]
		]);
	}, 60_000);

	it('refuses runed PersistedState and keeps the other import restrictions', async () => {
		const imports = `import { PersistedState } from 'runed';
import { Menu } from '@lucide/svelte';
export const state = [PersistedState, Menu];
`;
		for (const filePath of ['src/lib/example.ts', 'src/lib/theme.svelte.ts']) {
			expect(await storageReports(imports, filePath)).toEqual([
				['@typescript-eslint/no-restricted-imports', 1],
				['@typescript-eslint/no-restricted-imports', 2]
			]);
		}
	}, 60_000);

	it.each([
		['the storage boundary', 'src/lib/storage/web-storage.ts'],
		['the analytics durability probe', 'src/lib/analytics/storage.ts'],
		['the theme store, which guards its own access', 'src/lib/theme.svelte.ts'],
		['a test that seeds storage', 'src/lib/theme.svelte.test.ts']
	])(
		'leaves %s alone',
		async (_label, filePath) => {
			expect(existsSync(filePath)).toBe(true);
			expect(await storageReports(reads, filePath)).toEqual([]);
		},
		60_000
	);
});
