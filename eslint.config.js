import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import convexPlugin from '@convex-dev/eslint-plugin';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import requireMarketingMarkdownRule from './eslint/rules/require-marketing-markdown.js';
import requireMarketingRouteRegistrationRule from './eslint/rules/require-marketing-route-registration.js';
import noHardcodedAriaLabelRule from './eslint/rules/no-hardcoded-aria-label.js';
import noHardcodedSrOnlyRule from './eslint/rules/no-hardcoded-sr-only.js';
import noDebounceInRuneRule from './eslint/rules/no-debounce-in-rune.js';
import noHardcodedModifierKeysRule from './eslint/rules/no-hardcoded-modifier-keys.js';
import requireReturnsValidatorRule from './eslint/rules/require-returns-validator.js';
import noBareTestSkipRule from './eslint/rules/no-bare-test-skip.js';
import requireExplicitStorageStateRule from './eslint/rules/require-explicit-storage-state.js';
import noNetworkidleWaitRule from './eslint/rules/no-networkidle-wait.js';
import noModuleStateSingletonRule from './eslint/rules/no-module-state-singleton.js';
import requireMotionGuardTransitionRule from './eslint/rules/require-motion-guard-transition.js';
import requireFieldErrorAssociationRule from './eslint/rules/require-field-error-association.js';
import requireGuardedServerConvexClientRule from './eslint/rules/require-guarded-server-convex-client.js';
import noFrozenAuthPageDataRule from './eslint/rules/no-frozen-auth-page-data.js';
import noDestructuredLiveGettersRule from './eslint/rules/no-destructured-live-getters.js';
import requireSvelteModuleExtensionRule from './eslint/rules/require-svelte-module-extension.js';
import noAnimatedPixelPressRule from './eslint/rules/no-animated-pixel-press.js';
import preferShadcnPrimitivesRule from './eslint/rules/prefer-shadcn-primitives.js';
import preferShadcnSliderImportsRule from './eslint/rules/prefer-shadcn-slider-imports.js';
import safeSvelteParser from './eslint/parsers/safe-svelte-parser.js';
import noLiteralControlCharRule from './eslint/rules/no-literal-control-char.js';
import noDynamicImportRejectionHandlerRule from './eslint/rules/no-dynamic-import-rejection-handler.js';
import requireStaticModeInitializerRule from './eslint/rules/require-static-mode-initializer.js';
import noTestInLoopRule from './eslint/rules/no-test-in-loop.js';
import { enforcedShadcnConfig } from './eslint/shadcn-policy.js';

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
		'no-destructured-live-getters': noDestructuredLiveGettersRule,
		'no-hardcoded-modifier-keys': noHardcodedModifierKeysRule,
		'require-returns-validator': requireReturnsValidatorRule,
		'no-bare-test-skip': noBareTestSkipRule,
		'require-explicit-storage-state': requireExplicitStorageStateRule,
		'no-networkidle-wait': noNetworkidleWaitRule,
		'no-module-state-singleton': noModuleStateSingletonRule,
		'require-motion-guard-transition': requireMotionGuardTransitionRule,
		'require-field-error-association': requireFieldErrorAssociationRule,
		'require-guarded-server-convex-client': requireGuardedServerConvexClientRule,
		'no-frozen-auth-page-data': noFrozenAuthPageDataRule,
		'require-svelte-module-extension': requireSvelteModuleExtensionRule,
		'no-animated-pixel-press': noAnimatedPixelPressRule,
		'prefer-shadcn-primitives': preferShadcnPrimitivesRule,
		'prefer-shadcn-slider-imports': preferShadcnSliderImportsRule,
		'no-literal-control-char': noLiteralControlCharRule,
		'no-dynamic-import-rejection-handler': noDynamicImportRejectionHandlerRule,
		'require-static-mode-initializer': requireStaticModeInitializerRule,
		'no-test-in-loop': noTestInLoopRule
	}
};

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// Convex codegen and varlock emit a file-level `/* eslint-disable */`, which
	// switches off every rule from inside the generated file. The Convex and varlock
	// Convex outputs stay ignored because reaching them would require overriding the
	// generator's own directive and then exempting all of its generated style.
	//
	// `src/varlock-env.d.ts` carries the same directive, but it is written from environment
	// values, which come from outside this repository. It is the generated file most
	// exposed to a character nobody typed, so the later file block disables its inline
	// directive and exempts only the generated style rules it then trips.
	{
		ignores: [
			'scratch/**',
			'**/_generated/**',
			'src/lib/convex/convex-env.d.ts',
			'scripts/english-policy/pr-metadata.bundle.mjs'
		]
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
				// Reuse the tsconfig program for this CLI run. The editor project
				// service repeatedly refreshes it for Svelte's virtual files.
				project: true,
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				// Mirrors the compilerOptions passed to sveltekit() in vite.config.ts, without
				// importing that config and its build-time side effects.
				svelteConfig: { compilerOptions: { experimental: { async: true } } }
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

			// Mirrors oxlint typescript/consistent-type-imports for .svelte files. oxlint lints
			// their <script lang="ts"> blocks but skips this rule there, because it cannot see
			// template usages (#1117).
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
							message: '$app/stores was removed in SvelteKit 3. Use $app/state instead.'
						},
						{
							name: '$app/environment',
							message: '$app/environment was renamed to $app/env in SvelteKit 3.'
						},
						{
							name: '#lib/utils/utils.js',
							message: 'Import from #lib/utils.js instead (canonical location).'
						},
						...[
							'$env/static/public',
							'$env/static/private',
							'$env/dynamic/public',
							'$env/dynamic/private'
						].map((name) => ({
							name,
							message:
								'Use $app/env/public or $app/env/private and declare the variable in src/env.ts. Public variables are static there, so they are known at build time.'
						})),
						{
							name: 'svelte',
							importNames: ['createRawSnippet'],
							allowTypeImports: true,
							message:
								'createRawSnippet renders an unescaped HTML string. Render table text with renderTextCell from #lib/components/ui/data-table/index.js, or render a component.'
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
		// The root layout mounts ModeWatcher; src/app.html owns the theme initializer
		// whose CSP hash is derived from the template. See
		// eslint/rules/require-static-mode-initializer.js.
		files: ['src/routes/+layout.svelte'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/require-static-mode-initializer': 'error'
		}
	},
	{
		files: ['src/**/*.ts', 'src/**/*.js', 'src/**/*.svelte'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/prefer-shadcn-slider-imports': 'error'
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
			'local/require-field-error-association': 'error',
			'local/prefer-shadcn-primitives': 'error'
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
		// `.svelte.ts` rune modules. oxlint JS plugins reach .svelte script blocks, but
		// upstream has no tests for that path yet, so this guard lives in ESLint
		// (see eslint/rules/no-debounce-in-rune.js and #1117).
		files: ['src/**/*.svelte', 'src/**/*.svelte.ts'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-debounce-in-rune': 'error'
		}
	},
	{
		// useAuth() and useCustomer() expose their state through getters, so
		// destructuring freezes it. See eslint/rules/no-destructured-live-getters.js.
		files: ['src/**/*.svelte', 'src/**/*.ts'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-destructured-live-getters': 'error'
		}
	},
	{
		// Platform modifier labels (⌘ ⌃ ⌥) must come from #lib/hooks/is-mac.svelte.ts
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
		// (#508). See eslint/rules/no-bare-test-skip.js. A self-built browser
		// context inherits the project's signed-in session unless it names one.
		// See eslint/rules/require-explicit-storage-state.js.
		files: ['e2e/**/*.spec.ts'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-bare-test-skip': 'error',
			'local/require-explicit-storage-state': 'error'
		}
	},
	{
		// Network idle ignores WebSocket traffic, so it passes before Convex-driven
		// controls are usable; helpers under e2e/utils hide the same wait.
		// See eslint/rules/no-networkidle-wait.js.
		files: ['e2e/**/*.ts'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-networkidle-wait': 'error'
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
	{
		// Vite wraps client dynamic imports in its preload helper, and a rejection
		// handler on the first .then() inside it swallows vite:preloadError (#1026).
		// Server-only modules and the Convex backend are bundled without that
		// wrapper; universal route modules also run in the client.
		// See eslint/rules/no-dynamic-import-rejection-handler.js.
		files: ['src/**/*.{ts,js,svelte}'],
		ignores: [
			'src/lib/convex/**',
			'src/lib/server/**',
			'src/**/*.server.{ts,js}',
			'src/routes/**/+server.{ts,js}'
		],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-dynamic-import-rejection-handler': 'error'
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
	// A test declared inside a loop is a hand-built parameterization; Vitest's
	// `.each` states the cases as data. Playwright has no `.each` and its docs
	// parameterize with loops, so e2e specs are exempt.
	// See eslint/rules/no-test-in-loop.js.
	{
		files: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
		ignores: ['e2e/**'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-test-in-loop': 'error'
		}
	},
	// shadcn/lint: class names must produce CSS and stay readable to the linter.
	// Options live in eslint/shadcn-policy.js, which the policy tests also read.
	...enforcedShadcnConfig,
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
		files: ['src/varlock-env.d.ts'],
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
	})),
	{
		files: ['**/src/lib/convex/**/*.ts'],
		rules: {
			// An unbounded read fails once it crosses the 16 MiB / 32k-row transaction limit.
			'@convex-dev/no-collect-in-query': 'error'
		}
	},
	{
		// Convex runs queries and mutations with dynamic imports disabled, while
		// Node tests run them fine, so only the deployed function fails.
		files: ['**/src/lib/convex/**/*.ts'],
		ignores: ['**/*.test.ts', '**/__tests__/**', '**/*.fixtures.ts'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector: 'ImportExpression',
					message:
						'Convex rejects `import()` in queries and mutations ("dynamic module import unsupported"). Import statically, or put the dependency in its own function and call it by reference. Code that only actions run may disable this with the reason.'
				}
			]
		}
	},
	// Generated by the Better Auth CLI and owned upstream; its duplicate indexes
	// are not ours to remove.
	{
		files: ['src/lib/convex/betterAuth/schema.ts'],
		rules: {
			'@convex-dev/no-duplicate-indexes': 'off'
		}
	}
);
