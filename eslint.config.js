import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import convexPlugin from '@convex-dev/eslint-plugin';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';
import requireMarketingMarkdownRule from './eslint/rules/require-marketing-markdown.js';
import requireMarketingRouteRegistrationRule from './eslint/rules/require-marketing-route-registration.js';
import noHardcodedAriaLabelRule from './eslint/rules/no-hardcoded-aria-label.js';
import noHardcodedSrOnlyRule from './eslint/rules/no-hardcoded-sr-only.js';
import noDebounceInRuneRule from './eslint/rules/no-debounce-in-rune.js';
import noHardcodedModifierKeysRule from './eslint/rules/no-hardcoded-modifier-keys.js';
import requireReturnsValidatorRule from './eslint/rules/require-returns-validator.js';
import noBareTestSkipRule from './eslint/rules/no-bare-test-skip.js';
import noModuleStateSingletonRule from './eslint/rules/no-module-state-singleton.js';
import requireMotionGuardTransitionRule from './eslint/rules/require-motion-guard-transition.js';
import requireFieldErrorAssociationRule from './eslint/rules/require-field-error-association.js';
import requireGuardedServerConvexClientRule from './eslint/rules/require-guarded-server-convex-client.js';
import noFrozenAuthPageDataRule from './eslint/rules/no-frozen-auth-page-data.js';
import requireSvelteModuleExtensionRule from './eslint/rules/require-svelte-module-extension.js';
import noAnimatedPixelPressRule from './eslint/rules/no-animated-pixel-press.js';
import safeSvelteParser from './eslint/parsers/safe-svelte-parser.js';
import noLiteralControlCharRule from './eslint/rules/no-literal-control-char.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');
const localPlugin = {
	processors: {
		// Varlock writes a file-wide disable into generated environment types. Blank
		// that exact directive without changing its length, so ESLint still reports
		// the right locations and the generated file cannot switch this plugin off.
		'strip-generated-eslint-disable': {
			preprocess(text) {
				return [text.replace('/* eslint-disable */', (directive) => ' '.repeat(directive.length))];
			},
			postprocess(messageLists) {
				return messageLists.flat();
			},
			supportsAutofix: true
		}
	},
	rules: {
		'require-marketing-markdown': requireMarketingMarkdownRule,
		'require-marketing-route-registration': requireMarketingRouteRegistrationRule,
		'no-hardcoded-aria-label': noHardcodedAriaLabelRule,
		'no-hardcoded-sr-only': noHardcodedSrOnlyRule,
		'no-debounce-in-rune': noDebounceInRuneRule,
		'no-hardcoded-modifier-keys': noHardcodedModifierKeysRule,
		'require-returns-validator': requireReturnsValidatorRule,
		'no-bare-test-skip': noBareTestSkipRule,
		'no-module-state-singleton': noModuleStateSingletonRule,
		'require-motion-guard-transition': requireMotionGuardTransitionRule,
		'require-field-error-association': requireFieldErrorAssociationRule,
		'require-guarded-server-convex-client': requireGuardedServerConvexClientRule,
		'no-frozen-auth-page-data': noFrozenAuthPageDataRule,
		'require-svelte-module-extension': requireSvelteModuleExtensionRule,
		'no-animated-pixel-press': noAnimatedPixelPressRule,
		'no-literal-control-char': noLiteralControlCharRule
	}
};

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// Convex codegen and varlock emit a file-level `/* eslint-disable */`, which
	// switches off every rule from inside the generated file. The Convex and varlock
	// Convex outputs stay ignored because reaching them would require overriding the
	// generator's own directive and then exempting all of its generated style.
	//
	// `src/env.d.ts` carries the same directive, but it is written from environment
	// values, which come from outside this repository. It is the generated file most
	// exposed to a character nobody typed, so the later file block disables its inline
	// directive and exempts only the generated style rules it then trips.
	{
		ignores: ['**/_generated/**', 'src/lib/convex/convex-env.d.ts']
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		},
		rules: {
			// $bindable() / $props() destructuring patterns trip ESLint v10's
			// `no-useless-assignment` because the rule doesn't understand runes.
			// Default values like `ref = $bindable(null)` are real defaults that
			// the Svelte compiler uses when the prop isn't passed.
			'no-useless-assignment': 'off'
		}
	},
	// Project-specific TypeScript rule overrides
	{
		files: ['**/*.ts', '**/*.svelte'],
		rules: {
			// Only warn on unused variables, and ignore variables starting with `_`
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					varsIgnorePattern: '^_',
					argsIgnorePattern: '^_'
				}
			],

			// Allow escaping the compiler
			'@typescript-eslint/ban-ts-comment': 'error',

			// Off globally: ~26 legitimate usages in UI-kit/vendor code (shadcn, Konva, Rive, TanStack)
			'@typescript-eslint/no-explicit-any': 'off',

			// Mirrors oxlint typescript/consistent-type-imports — needed here because oxlint
			// does not yet parse <script lang="ts"> blocks inside .svelte files
			'@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: true }]
		}
	},
	// Convex-specific: suppress type-checked rules that don't apply to Convex handler patterns
	{
		files: ['**/src/lib/convex/**/*.ts'],
		rules: {
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/require-await': 'off',
			'@typescript-eslint/prefer-promise-reject-errors': 'off',
			'@typescript-eslint/await-thenable': 'off'
		}
	},
	// Prevent barrel imports from large icon libraries (breaks tree-shaking)
	{
		files: ['src/**/*.{ts,js,svelte}'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/require-svelte-module-extension': 'error',
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: '@lucide/svelte',
							message:
								"Import individual icons instead: import Icon from '@lucide/svelte/icons/icon-name'",
							allowTypeImports: true
						},
						{
							name: 'lucide-svelte',
							message:
								"Import individual icons instead: import Icon from 'lucide-svelte/icons/icon-name'",
							allowTypeImports: true
						},
						{
							name: '@tabler/icons-svelte',
							message:
								"Import individual icons instead: import Icon from '@tabler/icons-svelte/icons/icon-name'",
							allowTypeImports: true
						},
						{
							name: '$app/stores',
							message: '$app/stores is deprecated since SvelteKit 2.12. Use $app/state instead.'
						},
						{
							name: '$lib/utils/utils',
							message: 'Import from $lib/utils instead (canonical location).'
						},
						{
							name: '$lib/utils/utils.js',
							message: 'Import from $lib/utils.js instead (canonical location).'
						},
						{
							name: '$env/dynamic/public',
							message:
								'Use $env/static/public instead. All PUBLIC_* vars are known at build time in this project.'
						}
					]
				}
			]
		}
	},
	// No console.log/debug/info in src/ (frontend code)
	{
		files: ['src/**/*.{ts,js,svelte}'],
		ignores: ['src/lib/convex/**'],
		rules: {
			'no-console': ['error', { allow: ['warn', 'error'] }]
		}
	},
	{
		files: ['src/routes/**/*.svelte'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/require-marketing-markdown': 'error',
			'local/require-marketing-route-registration': 'error'
		}
	},
	{
		files: ['src/**/*.svelte'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-hardcoded-aria-label': 'error',
			'local/no-hardcoded-sr-only': 'error',
			'local/require-field-error-association': 'error'
		}
	},
	{
		// Marketing pages prerender, freezing page.data auth/billing at build time
		// (saas-starter #452). The rule internally narrows to the marketing surface
		// (marketing routes/components, the customer-support widget, and the
		// src/blocks marketing blocks) and covers both .svelte and .ts files.
		// See eslint/rules/no-frozen-auth-page-data.js.
		files: [
			'src/routes/**/*.{svelte,ts}',
			'src/lib/components/**/*.{svelte,ts}',
			'src/blocks/**/*.{svelte,ts}'
		],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-frozen-auth-page-data': 'error'
		}
	},
	{
		// Runes (`$effect`/`$derived`) and `useDebounce` appear in both components and
		// `.svelte.ts` rune modules. oxlint JS plugins do not support Svelte yet, so this
		// guard lives in ESLint (see eslint/rules/no-debounce-in-rune.js).
		files: ['src/**/*.svelte', 'src/**/*.svelte.ts'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-debounce-in-rune': 'error'
		}
	},
	{
		// Platform modifier labels (⌘ ⌃ ⌥) must come from $lib/hooks/is-mac.svelte
		// (cmdOrCtrl/ctrlSymbol/optionOrAlt) so non-mac users see the right modifier.
		// The hook itself is the only place allowed to define them.
		files: ['src/**/*.svelte', 'src/**/*.ts'],
		ignores: ['src/lib/hooks/is-mac.svelte.ts'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-hardcoded-modifier-keys': 'error'
		}
	},
	{
		// Every Convex function registration must declare a `returns` validator
		// (convex-guidelines). See eslint/rules/require-returns-validator.js.
		files: ['src/lib/convex/**/*.ts'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/require-returns-validator': 'error'
		}
	},
	{
		// Bare runtime test.skip() dodges timing races instead of fixing them
		// (#508). See eslint/rules/no-bare-test-skip.js.
		files: ['e2e/**/*.spec.ts'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-bare-test-skip': 'error'
		}
	},
	{
		// Module-scope class instances in .svelte.ts are shared across SSR
		// requests (#500). See eslint/rules/no-module-state-singleton.js.
		files: ['**/*.svelte.ts'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-module-state-singleton': 'error'
		}
	},
	{
		// fly/slide transitions must be gated on prefers-reduced-motion (#475).
		// See eslint/rules/require-motion-guard-transition.js.
		files: ['**/*.svelte'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/require-motion-guard-transition': 'error'
		}
	},
	{
		// The server Convex client throws synchronously on an unresolved Convex
		// URL (cold preview before env propagates); a per-query .catch does not
		// cover the construction line, so it must sit inside a try (#594).
		// See eslint/rules/require-guarded-server-convex-client.js.
		files: ['src/routes/**/+page.server.ts', 'src/routes/**/+layout.server.ts'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/require-guarded-server-convex-client': 'error'
		}
	},
	{
		files: ['src/**/*.svelte'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-animated-pixel-press': 'error'
		}
	},
	// A control or bidirectional character written as itself can disappear in review,
	// so this has to reach every file ESLint parses. Scoping it to src/ would leave
	// scripts/, config and the guard itself unchecked, which is where an invisible
	// character does the most damage.
	{
		files: ['**/*.{js,ts,svelte}'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-literal-control-char': 'error'
		}
	},
	// Valid Svelte files keep the ordinary parser and rule lifecycle. The wrapper
	// changes only a thrown parser message, which is the path that happens before a
	// Program visitor can sanitize the invalid token itself.
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parser: safeSvelteParser
		}
	},
	// Varlock puts a file-wide ESLint disable and empty marker interfaces in this
	// generated header. The processor blanks the directive without shifting source
	// locations; the rules below exempt the generated TypeScript style and nothing
	// else. The control-character rule therefore still runs on the real file text.
	{
		files: ['src/env.d.ts'],
		plugins: {
			local: localPlugin
		},
		processor: 'local/strip-generated-eslint-disable',
		rules: {
			'@typescript-eslint/ban-ts-comment': 'off',
			'@typescript-eslint/no-empty-object-type': 'off'
		}
	},
	// Convex best-practice rules — v2 ships ESLint 9 flat config natively
	...convexPlugin.configs.recommended.map((config) => ({
		...config,
		files: ['**/src/lib/convex/**/*.ts']
	}))
);
