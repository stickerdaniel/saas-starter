/**
 * Files whose content changes with the layout in a way no specifier rewrite reaches. Each entry
 * records the SHA-256 of the flat file at the commit it was written against; when `main` changes
 * that file, the generator stops and names it, so the entry is rewritten against the new text.
 */
import { createHash } from 'node:crypto';
import { editedText } from './mapper-steps.ts';
import { imageLines, imageLiterals } from './policy.ts';
import { readText, StaleInput, writeText, type Run } from './run.ts';

export type Edit =
	| readonly [before: string, after: string]
	| { readonly from: string; readonly until: string; readonly to: string }
	| { readonly all: string; readonly to: string };

export interface Image {
	readonly image: 'literals' | 'lines';
	readonly within?: `${string}/`;
	readonly edits?: readonly Edit[];
}

export interface Replacement {
	/** The flat path whose content the entry was written against. */
	readonly from: string;
	readonly sha256: string;
	/**
	 * The whole new content, literal edits of the moved file, each matching once, or the image of
	 * the moved file under the move table after its edits.
	 */
	readonly content: string | readonly Edit[] | Image;
}

const SKILLS_TSCONFIG = `{
	"extends": "../../tsconfig.base.json",
	"compilerOptions": {
		"declaration": false,
		"declarationMap": false,
		"noEmit": true,
		"types": ["node", "vitest/globals"]
	},
	"include": ["*/scripts/**/*.ts"]
}
`;

const APP_TSCONFIG = `{
	// SvelteKit writes this base config (paths, generated types, required compiler options)
	// during sync. It allows explicit .ts specifiers rather than rewriting them, which this
	// noEmit, Vite-built app relies on. The shared options of every workspace come first.
	"extends": ["../../tsconfig.base.json", "$app/tsconfig"],
	"files": ["scripts/check-table-scroll.ts", "scripts/check-streamdown-overlay.ts"],
	"compilerOptions": {
		"sourceMap": true,
		"declaration": true,
		"declarationMap": true
	},
	// The base config sets no include/exclude, so these replace the lists SvelteKit 2
	// generated: the app sources and the Vite config.
	"include": ["src/**/*.js", "src/**/*.ts", "src/**/*.svelte", "vite.config.ts"],
	"exclude": ["node_modules/**", "references/**", "src/service-worker"]
}
`;

const ROOT_TOOLING_CONFIG = `import { defineConfig, mergeConfig } from 'vitest/config';
import {
	sharedTestSettings,
	toolingTestSettings
} from './packages/tooling/src/vitest-settings.ts';

export default defineConfig({
	// Tooling tests must not depend on SvelteKit's generated tsconfig or application env.
	tsconfig: './tsconfig.tooling.json',
	// Every workspace runs its own tests; the root owns the files outside them.
	test: mergeConfig(mergeConfig(sharedTestSettings, toolingTestSettings), {
		exclude: ['apps/**', 'packages/**']
	})
});
`;

const CREATOR_TSCONFIG = `{
	"compilerOptions": {
		"target": "ES2023",
		"module": "NodeNext",
		"moduleResolution": "NodeNext",
		"strict": true,
		"noEmit": true,
		"allowImportingTsExtensions": true,
		"verbatimModuleSyntax": true,
		"skipLibCheck": true,
		"types": ["node", "vitest/globals"]
	},
	"include": ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts"]
}
`;

const CHECKER_EDITS: readonly Edit[] = [
	[
		"import {\n\tBASE_TABLE,\n\tWORKSPACES,\n\ttype Owner,\n\ttype StarterWorkspace\n} from '../.agents/skills/upstream-sync/layout/v3';",
		"import type { Owner, StarterWorkspace } from '../.agents/skills/upstream-sync/layout/v3';"
	],
	[
		"import { withSvelteKitSyncLock } from '../apps/web/scripts/svelte-kit-sync-lock';",
		"import { withSvelteKitSyncLock } from '../apps/web/scripts/svelte-kit-sync-lock';\nimport { WORKSPACE_CHECK_LAYOUT } from './workspace-check-layout';"
	],
	{
		from: "const EVERY_PATH: Route = { paths: [{ under: '' }] };\n",
		until: '/** The layout of this checkout: the value the checker runs on. */',
		to: 'const BANNED_PATTERN_SOURCE = /\\.(?:svelte|ts)$/;\n\n'
	},
	[
		'const CHECKOUT_LAYOUT: CheckLayout = FLAT_CHECK_LAYOUT;',
		'const CHECKOUT_LAYOUT: CheckLayout = WORKSPACE_CHECK_LAYOUT;'
	],
	[
		'const FLAT_ROUTED: Routed = routesOf(FLAT_CHECK_LAYOUT);\nexport const ROUTES: Routes = FLAT_ROUTED.routes;',
		'const CHECKOUT_ROUTED: Routed = routesOf(CHECKOUT_LAYOUT);\nexport const ROUTES: Routes = CHECKOUT_ROUTED.routes;'
	],
	[
		"proseKind: Routed['proseKind'] = FLAT_ROUTED.proseKind",
		"proseKind: Routed['proseKind'] = CHECKOUT_ROUTED.proseKind"
	],
	[
		'configs = typeProjectConfigs(FLAT_CHECK_LAYOUT),',
		'configs = typeProjectConfigs(CHECKOUT_LAYOUT),'
	],
	[
		"resolveCommand(\n\t\tFLAT_CHECK_LAYOUT,\n\t\tFLAT_CHECK_LAYOUT.tasks['convex compat']\n\t)",
		"resolveCommand(CHECKOUT_LAYOUT, CHECKOUT_LAYOUT.tasks['convex compat'])"
	],
	[
		"\t\tledger.ran('oxlint');\n\t\tconsole.log('\\n');\n",
		"\t\tledger.ran('oxlint');\n\t\tconsole.log('\\n');\n\n\t\tprintHeader(step++, 'Workspace graph');\n\t\tawait runCommand('bun', ['scripts/check-workspace-graph.ts'], atRoot);\n\t\tledger.ran('workspace graph');\n\t\tconsole.log('\\n');\n"
	]
];

const CHECKER_TEST_EDITS: readonly Edit[] = [
	[
		"import {\n\tmovedDifferences,\n\tmovedNewFiles,\n\tmovedTrackedPaths\n} from './__fixtures__/static-checks/moved-differences';\n",
		''
	],
	['\tFLAT_CHECK_LAYOUT,\n\tisIgnoredPath,', '\tisIgnoredPath,'],
	['\tconst moved = new Map(movedTrackedPaths(tracked));\n', ''],
	[
		'\t\texpect(namesNoPath(FLAT_CHECK_LAYOUT, tracked)).toEqual([]);\n\t\texpect(namesNoPath(WORKSPACE_CHECK_LAYOUT, [...moved.values()])).toEqual([]);',
		'\t\texpect(namesNoPath(WORKSPACE_CHECK_LAYOUT, tracked)).toEqual([]);'
	],
	[
		'expect(namesNoPath(impossible, [...moved.values()])).toEqual(',
		'expect(namesNoPath(impossible, tracked)).toEqual('
	],
	{
		from: "\tit('gives every tracked path on its moved path exactly the checks it has today', () => {",
		until:
			"\tit('routes a moved backend, app and translation file to the checks they get today', () => {",
		to: ''
	}
];

const IMAGED_POLICY_FILES: ReadonlyArray<readonly [from: string, sha256: string]> = [
	[
		'eslint/convex-library-functions.test.ts',
		'f15fd02f2b758c33e64387654c1374b98495f9c7a2207e4c7a63e475f42e4360'
	],
	[
		'eslint/rules/no-frozen-auth-page-data.test.ts',
		'02a11eb1a6c8fdef4e7309bb7f4d27eaf7afd45bd06ab867a75f6f4239522666'
	],
	[
		'eslint/__fixtures__/shadcn-restyle-spec.json',
		'cb6fd5647e1ab05a0f44a73c8bf3aa41dc6ba7149f446f98a13dc9d98f9e92b0'
	],
	[
		'eslint/rules/convex-access-first.js',
		'92b08a157a166665779d3db5ceb6f47874e5b6da15ce9fbafb91c1671c94a940'
	],
	[
		'eslint/rules/convex-access-first.test.ts',
		'a6d3191bc732f6111f0f3ea52a6c2d773f566f38019b8c3b16e95bdea1936eed'
	],
	[
		'eslint/rules/convex-canonical-registration.js',
		'f871e9e2583932db7d34b2c15e8b23881894e60410f1e765602aded04451d59d'
	],
	[
		'eslint/rules/no-destructured-live-getters.test.ts',
		'd2e8f81414f6cde8809cde68427418da3760ba2b7efd81c03e091ca7b0a43a85'
	],
	[
		'eslint/rules/no-frozen-auth-page-data.js',
		'6233b9ded6d28efb51a5ebc8ea196ed16065a8b894d61115bb722309d490253c'
	],
	[
		'eslint/rules/no-history-comment.test.ts',
		'9692919f250b0f09605401a0d79f0dacc0e886fd9eaa8ba620123d691f036970'
	],
	[
		'eslint/rules/no-middle-dot-or-em-dash.test.ts',
		'442cf5ed18439a364984c6dc38fd2cd0c721b57179533dbb5852c2faaa438045'
	],
	[
		'eslint/rules/no-own-barrel-import.test.ts',
		'8578169c8f302ea2740e7444c827ffeb3e8784fddf938cd76e1803e241176e8d'
	],
	[
		'eslint/rules/no-test-in-loop.test.ts',
		'248449db13455e1249f0fea91f2a988939b3a7a165887a217211740365bffb01'
	],
	[
		'eslint/rules/prefer-shadcn-primitives.test.ts',
		'86e5d020dd765a2061138277f5d3b7f547685364a512a62ecd71655368715bfe'
	],
	[
		'eslint/rules/prefer-shadcn-slider-imports.js',
		'02cf9c44c30b068e6eaeda252482d700a39cebc07da22efb10bff6a01b2749ba'
	],
	[
		'eslint/rules/require-guarded-server-convex-client.test.ts',
		'c8ccb5269df7329769c47596484750c626fa2bf87848c8ed0f6d5331fb1f56e2'
	],
	[
		'eslint/rules/variants-through-cn.test.ts',
		'60c114249680c47b2c19045025f6c651149354ff177919f0d6cf58c22754d30e'
	]
];

const DS_IMPORTS: Edit = { all: "'#lib/components/ui/", to: "'@repo/ui/src/components/ui/" };

const ALIASES_IMPORT = "import { aliasesFor } from '../workspace-aliases.js';\n";

const POLICY_REPLACEMENTS: readonly Replacement[] = [
	{
		from: 'eslint/config-coverage.test.ts',
		sha256: '99f9d7960b3a758d9fcf0f9bb043d31f116b4cd9b9880ca2e0c96c562953bf91',
		content: {
			image: 'literals',
			edits: [
				[
					'expect(rootTsconfig).toContain(\'"packages/create-saas-starter/**"\');',
					"expect(rootTsconfig).not.toContain('create-saas-starter');\n\t\texpect(existsSync('packages/create-saas-starter/tsconfig.json')).toBe(true);"
				]
			]
		}
	},
	{
		from: 'eslint/shadcn-restyle-policy.test.ts',
		sha256: 'c45c1a30663fa93375651d5d1fde258a11081612272007d3537b5843b6fb7214',
		content: { image: 'literals', edits: [DS_IMPORTS] }
	},
	{
		from: 'eslint/shadcn-policy.test.ts',
		sha256: '6b108325c94d62b3ff32eaa179dc6c088918ec042584b6ba05e328f3a5189abf',
		content: { image: 'literals', edits: [DS_IMPORTS] }
	},
	...IMAGED_POLICY_FILES.map(([from, sha256]) => ({
		from,
		sha256,
		content: { image: 'literals' } as const
	})),
	{
		from: 'eslint.config.js',
		sha256: 'bb3b6660456de872a59837261aa0e1b7fe38496d9ceb297a0a6a20beb458f435',
		content: {
			image: 'literals',
			edits: [
				[
					"import requireSessionStoreCleanupRule from './eslint/rules/require-session-store-cleanup.js';\n",
					"import requireSessionStoreCleanupRule from './eslint/rules/require-session-store-cleanup.js';\nimport { WORKSPACE_ALIASES } from './eslint/workspace-aliases.js';\n"
				],
				[
					"\t\t\t// Mirrors the `#lib/*` entry of package.json \"imports\".\n\t\t\t'local/require-svelte-module-extension': ['error', { aliases: { '#lib/': 'src/lib/' } }],\n",
					''
				],
				[
					'\t...enforcedShadcnConfig,\n',
					"\t...enforcedShadcnConfig,\n\t{ settings: { shadcn: { ui: ['@repo/ui/src/components/ui'] } } },\n"
				],
				[
					'\t\tfiles: convexRuntimeFiles\n\t})),\n',
					"\t\tfiles: convexRuntimeFiles\n\t})),\n\t{\n\t\tfiles: ['src/lib/convex/convex.config.ts'],\n\t\trules: { '@convex-dev/no-process-env': 'off' }\n\t},\n"
				],
				[
					'\t// Fontless invalidates fontless/runtime and its importers mid-request in dev.',
					"\t...WORKSPACE_ALIASES.map(({ directory, aliases }) => ({\n\t\tfiles: ['src/**/*.{ts,js,svelte}'].filter((pattern) => pattern.startsWith(directory)),\n\t\tplugins: { local: localPlugin },\n\t\trules: {\n\t\t\t'local/require-svelte-module-extension': [\n\t\t\t\t'error',\n\t\t\t\t{ aliases: Object.fromEntries(Object.entries(aliases).filter(([prefix]) => prefix.startsWith('#lib/'))) }\n\t\t\t]\n\t\t}\n\t})).filter(({ files }) => files.length > 0),\n\t// Fontless invalidates fontless/runtime and its importers mid-request in dev."
				]
			]
		}
	},
	{
		from: 'eslint/rules/no-own-barrel-import.js',
		sha256: '72c4894a204ec8989419ceb61b015fca3354ca6cef233297e11acf45c7471866',
		content: {
			image: 'literals',
			edits: [
				[
					"import { fileURLToPath } from 'node:url';\n",
					"import { fileURLToPath } from 'node:url';\n" + ALIASES_IMPORT
				],
				["const LIB_ALIAS = '#lib/';\n", ''],
				[
					"\tif (specifier.startsWith(LIB_ALIAS)) {\n\t\treturn path.join(REPOSITORY_ROOT, 'src/lib', specifier.slice(LIB_ALIAS.length));\n\t}\n",
					"\tconst aliases = aliasesFor(path.relative(REPOSITORY_ROOT, directory).split(path.sep).join('/'));\n\tconst alias = Object.keys(aliases).find(\n\t\t(prefix) => prefix.startsWith('#lib/') && specifier.startsWith(prefix)\n\t);\n\tif (alias) return path.join(REPOSITORY_ROOT, aliases[alias], specifier.slice(alias.length));\n"
				]
			]
		}
	},
	{
		from: 'eslint/rules/no-source-text-read.js',
		sha256: '3bbb89035b08b09e8c6f28281e4f5dbab621a1493920622b01c3388e5d751613',
		content: {
			image: 'literals',
			edits: [
				[
					"import { fileURLToPath, pathToFileURL } from 'node:url';\n",
					"import { fileURLToPath, pathToFileURL } from 'node:url';\nimport { aliasesFor, workspaceFor } from '../workspace-aliases.js';\n"
				],
				['an alias, or rooted at the repository.', 'an alias, or rooted at its workspace.'],
				[
					"return specifier.startsWith('/') ? path.join(cwd, specifier) : undefined;",
					"return specifier.startsWith('/')\n\t\t\t\t? path.join(cwd, workspaceFor(relativeFilename), specifier)\n\t\t\t\t: undefined;"
				],
				[
					"const ALIASES = { '#lib/': 'src/lib/', '#blocks/': 'src/blocks/', '$lib/': 'src/lib/' };",
					"const ALIAS_PREFIXES = ['#lib/', '#blocks/', '$lib/'];"
				],
				[
					'\t\t\tconst alias = Object.keys(ALIASES).find((prefix) => specifier.startsWith(prefix));\n\t\t\tif (alias) return path.join(cwd, ALIASES[alias], specifier.slice(alias.length));',
					'\t\t\tconst aliases = aliasesFor(relativeFilename);\n\t\t\tconst alias = Object.keys(aliases).find(\n\t\t\t\t(prefix) =>\n\t\t\t\t\tALIAS_PREFIXES.some((known) => prefix.startsWith(known)) && specifier.startsWith(prefix)\n\t\t\t);\n\t\t\tif (alias) return path.join(cwd, aliases[alias], specifier.slice(alias.length));'
				]
			]
		}
	},
	{
		from: 'eslint/rules/no-source-text-read.test.ts',
		sha256: '5e4cf914883b84b03697c767a479599ef2ab0dd34f8c897cfb9e2b89fcc6cbef',
		content: {
			image: 'literals',
			edits: [
				["const ROOT = 'src/lib';", "const ROOT = 'apps/web/src/lib';"],
				['`src/lib/convex/users.ts`', '`packages/backend/convex/users.ts`'],
				["import.meta.glob('/src/lib/convex/*.ts'", "import.meta.glob('/src/lib/server/*.ts'"],
				["'scripts/x.test.ts'", "'apps/web/scripts/x.test.ts'"],
				[
					"const ROOT = path.resolve(import.meta.dirname, '../..');\\nfunction read(",
					"const ROOT = path.resolve(import.meta.dirname, '../../../..');\\nfunction read("
				],
				[
					"'scripts/__fixtures__/static-checks/private-checkout.ts'",
					"'scripts/__fixtures__/static-checks/checker-harness.ts'"
				]
			]
		}
	},
	{
		from: 'eslint/rules/prefer-shadcn-slider-imports.test.ts',
		sha256: '016f0573c677ca383e15734ef46d84dbc6e18f8d5c7a25439be474a20687512c',
		content: {
			image: 'literals',
			edits: [["path.join(repoRoot, 'src')", "path.join(repoRoot, 'apps/web/src')"]]
		}
	},
	{
		from: 'eslint/shadcn-policy.js',
		sha256: '41efc4e7b46629c952427af304d1d13a75d6ee593fc374a9f49ed6176094f413',
		content: {
			image: 'literals',
			edits: [
				[
					"rules: { 'shadcn/no-raw-colors': 'off', 'shadcn/no-inline-styles': 'off' }",
					"rules: {\n\t\t\t'shadcn/no-raw-colors': 'off',\n\t\t\t'shadcn/no-inline-styles': 'off',\n\t\t\t'shadcn/no-restyle': 'off'\n\t\t}"
				]
			]
		}
	},
	{
		from: 'eslint/rules/variants-through-cn.js',
		sha256: '5f6a1f74f35af5ea9796c70e4cf5e2a42615bfe9c4b6f225fc7cf791a2a372d6',
		content: [
			[
				"const CN_SOURCE = '#lib/utils.js';",
				"const CN_SOURCES = new Set(['#lib/utils.js', '@repo/ui/src/utils.ts']);"
			],
			['source === CN_SOURCE', 'CN_SOURCES.has(source)']
		]
	},
	{
		from: 'components.json',
		sha256: '61c6010da9f95d7a09f3c641ba7a5ac1d4cd5ab6fa22e60513d2bf259cef880f',
		content: [['"css": "src/routes/layout.css"', '"css": "../../apps/web/src/routes/layout.css"']]
	},
	{
		from: '.oxlintrc.json',
		sha256: '61158eec5c8ef418c1d23f5e43d85737b735f80afa4a12df2199b1ab44bcc02c',
		content: { image: 'literals' }
	},
	{
		from: '.prettierrc',
		sha256: 'ac614ae56044e2cd2ede1434da9fb63f7319c198aafab7373c2dc5e41943b489',
		content: { image: 'literals' }
	},
	{
		from: '.prettierignore',
		sha256: '0e92c814b7cca4af65822d8eae712fb3df5f1d148b557c08937b5885e3949a89',
		content: { image: 'lines' }
	},
	{
		from: '.gitignore',
		sha256: 'a72be5a246c0d4600ef5e9edc67c73bc631216329bfd6df72f1f4e62b5c64cb1',
		content: {
			image: 'lines',
			edits: [['/.svelte-kit\n/build\n', '/apps/web/.svelte-kit\n/apps/web/build\n']]
		}
	},
	{
		from: 'knip.config.ts',
		sha256: '99ca077cadb791844d1ee95889ef441ab877efde7f112ec153b963d02baf2084',
		content: {
			image: 'literals',
			within: 'apps/web/',
			edits: [
				["\t\t'eslint/shadcn-policy.js',\n", ''],
				["\t\t'tw-animate-css',\n", "\t\t'tw-animate-css',\n\t\t'tailwindcss',\n\t\t'esm-env',\n"],
				["\t\t'scripts/english-policy/pr-metadata.ts',\n", ''],
				[
					"\t\t// The move generator, which the move deletes with its inputs.\n\t\t'scripts/layout/apply.ts',\n",
					''
				],
				[
					"\t\t// Policy DSL consumed by knowledge-policy.config.ts. Helpers a fork has not used\n\t\t// yet are its public surface, so unused exports here are not dead code.\n\t\t'scripts/knowledge-policy/policy.ts',\n",
					''
				],
				[
					"\t\t// Checked by packages/create-saas-starter/knip.config.ts in the same lint gate.\n\t\t'packages/create-saas-starter/**',\n",
					''
				]
			]
		}
	},
	{
		from: 'knowledge-policy.config.ts',
		sha256: '1dfa7dfb733be89508457d1e9fa86dd502bcbe256c17d1c02a6614d9ab74ca37',
		content: {
			image: 'literals',
			edits: [['const authoredLegalTemplates = ', 'export const authoredLegalTemplates = ']]
		}
	}
];

export const REPLACEMENTS: readonly Replacement[] = [
	...POLICY_REPLACEMENTS,
	{
		from: 'scripts/static-checks.ts',
		sha256: 'd25cc5ad6e36b121c190431c93ff1677a4331e85613f28d8458ab087d28053e4',
		content: CHECKER_EDITS
	},
	{
		from: 'scripts/static-checks.test.ts',
		sha256: '6e7dcfc60e1bf7e751926876f49f34de501660acf2b340fff285010d4148a1ea',
		content: CHECKER_TEST_EDITS
	},
	{
		from: 'scripts/__fixtures__/static-checks/prose-workers.ts',
		sha256: '6096b00a6dfd4b785df88922b19632185a2cfa7639b76f76307b2f71ff421ff6',
		content: [
			[
				'files, named relative to one directory and read as the flat or the workspace layout does.\n * Usage: `bun prose-workers.ts <worker entry path | default> <directory> <flat | workspace> <files...>`.',
				'files, named relative to one directory and read as the layout of the checkout does.\n * Usage: `bun prose-workers.ts <worker entry path | default> <directory> <layout> <files...>`.'
			],
			[
				"import {\n\tenglishProseFiles,\n\tenglishProseFindings,\n\tFLAT_CHECK_LAYOUT,\n\troutesOf\n} from '../../static-checks';",
				"import { englishProseFiles, englishProseFindings, routesOf } from '../../static-checks';"
			],
			[
				'const [entry, directory, layout, ...names] = process.argv.slice(2);',
				'const [entry, directory, , ...names] = process.argv.slice(2);'
			],
			[
				"routesOf(layout === 'workspace' ? WORKSPACE_CHECK_LAYOUT : FLAT_CHECK_LAYOUT).proseKind",
				'routesOf(WORKSPACE_CHECK_LAYOUT).proseKind'
			]
		]
	},
	{
		from: 'packages/create-saas-starter/scripts/build.ts',
		sha256: '966fcfb472712fde345ee073647b9f59a4e9a8c045a4fabcd2343060e04a1e5f',
		content: [
			[
				"path.resolve(root, '../../scripts/windows-job-runner.ps1'),",
				"path.join(import.meta.dirname, '../node_modules/@repo/tooling/src/windows-job-runner.ps1'),"
			]
		]
	},
	{
		from: 'packages/create-saas-starter/scripts/test-packed.ts',
		sha256: '8f88ef24cd462635be40337f991bdafcc01ab680106c4238e4ea0cc0d8c603fa',
		content: [
			[
				"readFileSync(path.resolve(root, '../../scripts/windows-job-runner.ps1'))",
				"readFileSync(path.join(import.meta.dirname, '../node_modules/@repo/tooling/src/windows-job-runner.ps1'))"
			]
		]
	},
	{
		from: 'src/lib/confect/goldens.runtime.test.ts',
		sha256: '8ab5c1724b038067e8ec46c80b45b24b6a2e849ead9971806eb9fc4d7df8e005',
		content: [
			[
				"\tconst { readFileSync } = await import('node:fs');\n",
				"\tconst { readFileSync } = await import('node:fs');\n\tconst { join } = await import('node:path');\n"
			],
			[
				"readFileSync('.env-convex.schema', 'utf8')",
				"readFileSync(join(import.meta.dirname, '../.env-convex.schema'), 'utf8')"
			]
		]
	},
	{
		from: 'src/routes/layout.css',
		sha256: 'b16a4464161fa0911cdc0f5ab2a5b29e6074e1dc4dcd86237aa7fac4148ab58f',
		content: [
			[
				"@import '../lib/components/ui/tokens.css';",
				"@import '@repo/ui/src/components/ui/tokens.css';"
			]
		]
	},
	{
		from: 'tsconfig.json',
		sha256: 'b9e84d2dfc23495c0dc9a5cd64e15803e209696cd27ccb621c233e53d5a6413a',
		content: APP_TSCONFIG
	},
	{
		from: 'vitest.tooling.config.ts',
		sha256: '4254fe08c4d3b0b8503ebcfc55b0155faf8839668f04ff30cbdde5a4a1ed31e4',
		content: ROOT_TOOLING_CONFIG
	},
	{
		from: 'packages/create-saas-starter/tsconfig.json',
		sha256: 'af8853a90d7130497609b0805f6088617a86e6090214c74bceb96e9e08809368',
		content: CREATOR_TSCONFIG
	},
	{
		from: '.agents/skills/tsconfig.json',
		sha256: 'c4ce42e60b5e20e4fc44123ecec4fe042204e0ba795f1bf1369dd9ae7cc66d9c',
		content: SKILLS_TSCONFIG
	},
	{
		from: '.env-convex.schema',
		sha256: 'e25fe0131aadc7c6b66d8fe34ab579b9ab61303a2f41193fc11bff7305f7701a',
		content: [
			[
				'@generateTsTypes(path=src/lib/confect/convex-env.d.ts)',
				'@generateTsTypes(path=confect/convex-env.d.ts)'
			]
		]
	},
	{
		from: 'src/lib/i18n/static-translations.generated.ts',
		sha256: 'a453aa74ce967650b5ed5b85d8bb6115cba4ab8a514cb0e8aa941f20682495ab',
		content: (['en', 'de', 'es', 'fr'] as const).map((code) => [
			`import ${code} from './${code}.json';`,
			`import ${code} from './${code}.json' with { type: 'json' };`
		])
	},
	{
		from: 'scripts/generate-authored-content.ts',
		sha256: 'd3da129927eb315f0d84e2c8729a3fa45fe41c7d034d513a083e3bc753b1c6d2',
		content: [
			["'src/lib/confect/support/instructions.txt'", "'confect/support/instructions.txt'"],
			[
				"'src/lib/confect/support/instructions.generated.ts'",
				"'confect/support/instructions.generated.ts'"
			],
			[
				"'src/lib/convex/support/instructions.generated.ts'",
				"'convex/support/instructions.generated.ts'"
			],
			["'src/lib/convex/convex-env.d.ts'", "'convex/convex-env.d.ts'"]
		]
	},
	{
		from: 'scripts/build-emails.ts',
		sha256: 'eb5d8202dd97d3c584d5c4bd1f0f3f3ca0cbd84e13cdc9e0803b3927609585cf',
		content: [
			["'../src/lib/emails/generated'", "'../src/generated'"],
			["'../src/lib/convex/emails/_generated'", "'../../backend/convex/emails/_generated'"],
			["'/src/lib/emails/templates'", "'/src/templates'"],
			["'/src/lib/emails/renderer.ts'", "'/src/renderer.ts'"]
		]
	}
];

export function sha256(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}

function editProblem(path: string, text: string, before: string): string | undefined {
	const first = text.indexOf(before);
	if (first !== -1 && text.indexOf(before, first + 1) === -1) return undefined;
	return `${path} holds ${before} ${first === -1 ? 'nowhere' : 'more than once'}, not once`;
}

export function applyEdits(
	path: string,
	text: string,
	edits: readonly Edit[]
): { text: string; problems: string[] } {
	const problems: string[] = [];
	const result = edits.reduce((current, edit) => {
		if ('all' in edit) {
			if (current.includes(edit.all)) return current.replaceAll(edit.all, () => edit.to);
			problems.push(`${path} holds ${edit.all} nowhere`);
			return current;
		}
		if (!('from' in edit)) {
			const [before, after] = edit;
			const problem = editProblem(path, current, before);
			if (problem) {
				problems.push(problem);
				return current;
			}
			return current.replace(before, () => after);
		}
		const markers = [edit.from, edit.until].map((marker) => editProblem(path, current, marker));
		const found = markers.filter((problem) => problem !== undefined);
		const start = current.indexOf(edit.from);
		const end = current.indexOf(edit.until);
		if (found.length || end < start) {
			problems.push(
				...found,
				...(end < start && !found.length ? [`${path} holds ${edit.until} before ${edit.from}`] : [])
			);
			return current;
		}
		return current.slice(0, start) + edit.to + current.slice(end);
	}, text);
	return { text: result, problems };
}

type Projection = Pick<Run, 'flatFile' | 'table' | 'rewrites'>;

function replacedText(
	run: Pick<Run, 'table'>,
	from: string,
	to: string,
	current: string,
	content: Replacement['content']
): { text: string; problems: readonly string[] } {
	if (typeof content === 'string') return { text: content, problems: [] };
	if (!('image' in content)) return applyEdits(to, current, content);
	const { image, within, edits = [] } = content;
	const edited = applyEdits(to, current, edits);
	if (image === 'lines')
		return { text: imageLines(run.table, edited.text), problems: edited.problems };
	const imaged = imageLiterals(run.table, { from, to }, edited.text, within);
	return { text: imaged.text, problems: [...edited.problems, ...imaged.problems] };
}

function projectedText(run: Projection, from: string, to: string): string {
	const rewrites = run.rewrites
		.filter(({ file }) => file === to)
		.map(({ literalOffset, specifier, next }) => ({
			file: to,
			literalOffset,
			from: specifier,
			to: next
		}));
	return editedText(to, run.flatFile(from), rewrites).text;
}

/** The flat files that changed since the replacement for each was written. */
export function staleReplacements(
	flatFile: (path: string) => string,
	replacements: readonly Replacement[] = REPLACEMENTS
): string[] {
	return replacements
		.filter(({ from, sha256: recorded }) => sha256(flatFile(from)) !== recorded)
		.map(
			({ from }) =>
				`${from} changed since its replacement in scripts/layout/replacements.ts was written; rewrite the replacement against the new file and record its SHA-256`
		);
}

export function replacementProblems(
	run: Projection,
	replacements: readonly Replacement[] = REPLACEMENTS
): string[] {
	const stale = staleReplacements(run.flatFile, replacements);
	if (stale.length) return stale;
	return replacements.flatMap(({ from, content }) => {
		const to = run.table.place(from)?.to;
		if (!to) return [`The move table deletes ${from}, which a replacement names`];
		return replacedText(run, from, to, projectedText(run, from, to), content).problems;
	});
}

export function verifyReplacements(run: Run): void {
	const problems = replacementProblems(run, run.inputs.replacements);
	if (problems.length) throw new StaleInput(problems.join('\n'));
}

/** Writes each replacement at the moved place of its flat file. */
export function writeReplacements(run: Run): void {
	for (const { from, content } of run.inputs.replacements) {
		const to = run.table.place(from)?.to;
		if (!to) throw new StaleInput(`The move table deletes ${from}, which a replacement names`);
		const { text, problems } = replacedText(
			run,
			from,
			to,
			typeof content === 'string' ? '' : readText(run, to),
			content
		);
		if (problems.length) throw new StaleInput(problems.join('\n'));
		writeText(run, to, text);
	}
}
