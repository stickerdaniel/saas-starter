// Must stay first: the Svelte parser reads this flag when it is imported.
import './eslint/svelte-ts-sys-hook.js';
import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import convexPlugin from '@convex-dev/eslint-plugin';
import svelte from 'eslint-plugin-svelte';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import requireMarketingMarkdownRule from './eslint/rules/require-marketing-markdown.js';
import requireMarketingRouteRegistrationRule from './eslint/rules/require-marketing-route-registration.js';
import noHardcodedAriaLabelRule from './eslint/rules/no-hardcoded-aria-label.js';
import noHardcodedSrOnlyRule from './eslint/rules/no-hardcoded-sr-only.js';
import noDebounceInRuneRule from './eslint/rules/no-debounce-in-rune.js';
import noHardcodedModifierKeysRule from './eslint/rules/no-hardcoded-modifier-keys.js';
import requireFieldErrorAssociationRule from './eslint/rules/require-field-error-association.js';
import requireGuardedServerConvexClientRule from './eslint/rules/require-guarded-server-convex-client.js';
import noFrozenAuthPageDataRule from './eslint/rules/no-frozen-auth-page-data.js';
import noDestructuredLiveGettersRule from './eslint/rules/no-destructured-live-getters.js';
import noAnimatedPixelPressRule from './eslint/rules/no-animated-pixel-press.js';
import preferShadcnPrimitivesRule from './eslint/rules/prefer-shadcn-primitives.js';
import preferShadcnSliderImportsRule from './eslint/rules/prefer-shadcn-slider-imports.js';
import variantsThroughCnRule from './eslint/rules/variants-through-cn.js';
import safeSvelteParser from './eslint/parsers/safe-svelte-parser.js';
import noMiddleDotOrEmDashRule from './eslint/rules/no-middle-dot-or-em-dash.js';
import noTestInLoopRule from './eslint/rules/no-test-in-loop.js';
import noRawCaughtErrorLogRule from './eslint/rules/no-raw-caught-error-log.js';
import noHistoryCommentRule from './eslint/rules/no-history-comment.js';
import convexCanonicalRegistrationRule from './eslint/rules/convex-canonical-registration.js';
import convexAccessFirstRule from './eslint/rules/convex-access-first.js';
import convexEffectQuerySafetyRule from './eslint/rules/convex-effect-query-safety.js';
import confectDefinitionImportsRule from './eslint/rules/confect-definition-imports.js';
import noSourceTextReadRule from './eslint/rules/no-source-text-read.js';
import { enforcedShadcnConfig } from './eslint/shadcn-policy.js';
import {
	CONFECT_LIBRARY_FUNCTIONS,
	PLAIN_HTTP_ROUTES,
	PLAIN_REGISTRATION_PATHS,
	RAW_REGISTRARS
} from './eslint/convex-registrars.js';
import saasStarterPlugin from 'eslint-plugin-saas-starter';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');
// Names the guards that open a public Convex handler. A guard throws on refusal;
// a boolean predicate such as `canEdit` or `hasRole` is no guard.
const convexAccessPattern = '^(require|assert|ensure)([A-Z_]|$)';
const CONFECT_PUBLIC_FUNCTIONS = {
	'auth:getAvailableOAuthProviders':
		'The sign-in page lists the configured providers before anyone signs in.',
	'capabilities:getUsability':
		'Every page, signed in or not, hides the controls of an unconfigured capability.',
	'support/threads:getAdminAvatars':
		'The support widget shows admin names and avatars to every visitor.',
	'support/files:getAttachmentText':
		'Anonymous visitors preview text attachments; the preview rate limit bounds each owner.',
	'support/files:saveUploadedFile':
		'It refuses every call before any effect; uploads arrive through POST /uploads/support.',
	'aiChat/files:getAttachmentText':
		'Its first step, checkPreviewAccess, requires a session and spends a preview token before any fetch.',
	'aiChat/files:saveUploadedFile':
		'It refuses every call before any effect; uploads arrive through POST /uploads/aiChat.',
	'support/messages:getFileMetadataBatch':
		'Returns only image dimensions for storage URLs the caller already holds.',
	...Object.fromEntries(
		[
			'cleanupAnonymousSupportThreads',
			'cleanupTestData',
			'createAnonymousSupportThread',
			'createTestAdminUser',
			'createUnreadAnonymousSupportReply',
			'deleteAiChatHistoryRows',
			'deleteAuditLogRows',
			'deleteOwnedFixture',
			'deleteSupportNotificationFixture',
			'deleteTestUser',
			'findOwnedTestData',
			'getAuthUserIdByEmail',
			'getLegacyAuditLogCursor',
			'getPasswordResetToken',
			'getSupportThreadsByUserId',
			'health',
			'recoverSupportNotificationFixture',
			'resetAiChatFileUploadLimit',
			'resetOAuthRegistrationLimit',
			'seedAiChatHistoryRows',
			'seedAuditLogRows',
			'seedSupportNotificationClaim',
			'verifyAccessToken',
			'verifyTestUserEmail'
		].map((name) => [
			`tests:${name}`,
			'E2E fixture endpoint: its handler first refuses every caller without AUTH_E2E_TEST_SECRET, which only test deployments set.'
		])
	)
};
// Code the Convex runtime loads: the registration modules in the functions directory,
// the helpers, tests and shared validators beside it, and the local components.
const CONVEX_RUNTIME_DIRS = ['src/lib/convex', 'src/lib/confect', 'src/lib/convex-components'];
const convexRuntimeFiles = CONVEX_RUNTIME_DIRS.map((dir) => `${dir}/**/*.ts`);
const convexRuntimeTrees = CONVEX_RUNTIME_DIRS.map((dir) => `${dir}/**`);
const FONTLESS_RUNTIME_IMPORT = {
	name: 'fontless/runtime',
	message:
		'Import fontless/runtime only in src/routes/+layout.svelte. Elsewhere, its dev invalidation re-evaluates its importers mid-request. Server code can read the preload links the layout rendered.'
};
const SCHEMA_LIBRARY_MESSAGE =
	'Convex code validates with effect/Schema. A file that must keep valibot is listed in SCHEMA_LIBRARY_EXCEPTIONS with its reason.';
const SCHEMA_LIBRARY_EXCEPTIONS = {
	'src/lib/confect/admin/types.ts':
		'The admin users page imports it, so its valibot schemas ship to the browser.',
	'src/lib/confect/users.impl.ts':
		'It parses with passwordValidation from src/lib/schemas/password.ts, which the password forms share.',
	'src/lib/confect/authServer.ts':
		"Better Auth returns the locale validator's issue message to API callers, and that message is valibot's."
};
const EFFECT_LEAF_MODULES = [
	'errors',
	'retry',
	'timeout',
	'lifetime',
	'scheduler',
	'clock',
	'testing'
].map((name) => `src/lib/effect/${name}.ts`);
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
		...saasStarterPlugin.rules,
		'require-marketing-markdown': requireMarketingMarkdownRule,
		'require-marketing-route-registration': requireMarketingRouteRegistrationRule,
		'no-hardcoded-aria-label': noHardcodedAriaLabelRule,
		'no-hardcoded-sr-only': noHardcodedSrOnlyRule,
		'no-debounce-in-rune': noDebounceInRuneRule,
		'no-destructured-live-getters': noDestructuredLiveGettersRule,
		'no-hardcoded-modifier-keys': noHardcodedModifierKeysRule,
		'require-field-error-association': requireFieldErrorAssociationRule,
		'require-guarded-server-convex-client': requireGuardedServerConvexClientRule,
		'no-frozen-auth-page-data': noFrozenAuthPageDataRule,
		'no-animated-pixel-press': noAnimatedPixelPressRule,
		'prefer-shadcn-primitives': preferShadcnPrimitivesRule,
		'prefer-shadcn-slider-imports': preferShadcnSliderImportsRule,
		'variants-through-cn': variantsThroughCnRule,
		'no-middle-dot-or-em-dash': noMiddleDotOrEmDashRule,
		'no-test-in-loop': noTestInLoopRule,
		'no-raw-caught-error-log': noRawCaughtErrorLogRule,
		'no-history-comment': noHistoryCommentRule,
		'convex-canonical-registration': convexCanonicalRegistrationRule,
		'convex-access-first': convexAccessFirstRule,
		'convex-effect-query-safety': convexEffectQuerySafetyRule,
		'confect-definition-imports': confectDefinitionImportsRule,
		'no-source-text-read': noSourceTextReadRule
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
			'src/lib/confect/convex-env.d.ts',
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
			// typescript-eslint advises against no-undef on TypeScript projects:
			// https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	// A suppression says why after ` -- `, so a reviewer can judge it where it stands.
	// The plugin reads JS and TS comments, including Svelte `<script>` blocks; it does
	// not see directives in Svelte markup comments.
	{
		plugins: { '@eslint-community/eslint-comments': eslintComments },
		rules: { '@eslint-community/eslint-comments/require-description': 'error' }
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
			// $bindable() and $props() destructuring patterns trip ESLint v10's
			// `no-useless-assignment`, which does not understand runes. Defaults like
			// `ref = $bindable(null)` are real defaults the Svelte compiler uses when the
			// prop is not passed.
			'no-useless-assignment': 'off'
		}
	},
	{
		files: ['**/*.ts', '**/*.svelte'],
		rules: {
			// Unused variables warn, and names starting with `_` are ignored
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					varsIgnorePattern: '^_',
					argsIgnorePattern: '^_'
				}
			],

			'@typescript-eslint/ban-ts-comment': 'error',

			// Off globally: ~26 legitimate usages in UI-kit/vendor code (shadcn, Konva, TanStack)
			'@typescript-eslint/no-explicit-any': 'off',

			// Mirrors oxlint typescript/consistent-type-imports for .svelte files. oxlint lints
			// their <script lang="ts"> blocks but skips this rule there, because it cannot see
			// template usages (#1117).
			'@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: true }]
		}
	},
	// Type-checked rules that do not apply to Convex handler patterns
	{
		files: convexRuntimeFiles,
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
	// Barrel imports from large icon libraries break tree-shaking
	{
		files: ['src/**/*.{ts,js,svelte}'],
		plugins: {
			local: localPlugin
		},
		rules: {
			// Mirrors the `#lib/*` entry of package.json "imports".
			'local/require-svelte-module-extension': ['error', { aliases: { '#lib/': 'src/lib/' } }],
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
	// Fontless invalidates fontless/runtime and its importers mid-request in dev. The root
	// layout's importer graph is small; a server hook's spans most modules, because
	// $app/paths reaches the hooks through the generated server.
	{
		files: ['src/**/*.{ts,js,svelte}'],
		ignores: ['src/routes/+layout.svelte'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [FONTLESS_RUNTIME_IMPORT]
				}
			]
		}
	},
	{
		files: convexRuntimeFiles,
		ignores: Object.keys(SCHEMA_LIBRARY_EXCEPTIONS),
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						FONTLESS_RUNTIME_IMPORT,
						...['valibot', 'zod'].map((name) => ({ name, message: SCHEMA_LIBRARY_MESSAGE }))
					],
					patterns: [{ group: ['valibot/*', 'zod/*'], message: SCHEMA_LIBRARY_MESSAGE }]
				}
			]
		}
	},
	// No console.log, debug or info in src/ (frontend code)
	{
		files: ['src/**/*.{ts,js,svelte}'],
		ignores: convexRuntimeTrees,
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
		files: ['src/**/*.ts', 'src/**/*.js', 'src/**/*.svelte'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/prefer-shadcn-slider-imports': 'error',
			'local/variants-through-cn': 'error'
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
		// (convex-guidelines). See packages/eslint-plugin/src/rules/require-returns-validator.js.
		files: convexRuntimeFiles,
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/require-returns-validator': ['error', { builders: RAW_REGISTRARS }]
		}
	},
	{
		// Bare runtime test.skip() dodges timing races instead of fixing them
		// (#508). See packages/eslint-plugin/src/rules/no-bare-test-skip.js. A
		// self-built browser context inherits the project's signed-in session
		// unless it names one.
		// See packages/eslint-plugin/src/rules/require-explicit-storage-state.js.
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
		// See packages/eslint-plugin/src/rules/no-networkidle-wait.js.
		files: ['e2e/**/*.ts'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-networkidle-wait': 'error'
		}
	},
	{
		// The raw runner skips the client error guard; e2e/utils/test.ts adds it.
		// `default` is the same `test`, and 'playwright/test' the same module.
		files: ['e2e/**/*.ts'],
		ignores: ['e2e/utils/test.ts'],
		rules: {
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{
					paths: ['@playwright/test', 'playwright/test'].map((name) => ({
						name,
						importNames: ['test', 'default'],
						allowTypeImports: true,
						message:
							"Import `test` from e2e/utils/test.ts, which fails a test on unexpected client errors. `expect` and types stay on '@playwright/test'."
					}))
				}
			]
		}
	},
	{
		// The auth setup projects open the first page of a run, so a cold local
		// route compile lands inside their test budget.
		files: ['playwright.config.ts'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector:
						"ObjectExpression:has(> Property[key.name='name'][value.value=/^(admin-)?setup$/]):not(:has(> Property[key.name='timeout']))",
					message:
						'Give the auth setup projects their own `timeout`: the first page of a run pays the cold route compile, and `navigationTimeout` cannot extend the test deadline.'
				}
			]
		}
	},
	{
		// Module-scope class instances in .svelte.ts are shared across SSR
		// requests (#500). See packages/eslint-plugin/src/rules/no-module-state-singleton.js.
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
		// See packages/eslint-plugin/src/rules/require-motion-guard-transition.js.
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
		// The server console ends up in a log store, and a caught error's message,
		// cause or request path can carry user input or tokens.
		// See eslint/rules/no-raw-caught-error-log.js.
		files: [
			'src/hooks.server.ts',
			'src/**/*.server.ts',
			'src/**/+server.ts',
			'src/**/*.remote.ts',
			'src/lib/server/**/*.ts'
		],
		ignores: ['**/*.test.ts'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-raw-caught-error-log': 'error'
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
		// See packages/eslint-plugin/src/rules/no-dynamic-import-rejection-handler.js.
		files: ['src/**/*.{ts,js,svelte}'],
		ignores: [
			...convexRuntimeTrees,
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
	// A comment states how the code works; history goes to the commit or PR.
	// See eslint/rules/no-history-comment.js.
	{
		files: ['**/*.{js,mjs,cjs,ts,svelte}'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-history-comment': 'error'
		}
	},
	// The template bans the middle dot and the em dash from everything the app ships.
	// Tests and their fixtures are not shipped, and they assert or record text in
	// its source form. See eslint/rules/no-middle-dot-or-em-dash.js.
	{
		files: ['src/**/*.{js,ts,svelte}'],
		ignores: ['**/*.{test,spec}.{js,ts}', '**/__tests__/**', '**/__fixtures__/**'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-middle-dot-or-em-dash': 'error'
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
	// A test imports what it tests; reading production source as text pins its
	// wording instead of its behaviour. See eslint/rules/no-source-text-read.js.
	{
		// The suffixes Vitest and Playwright run as tests.
		files: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/no-source-text-read': [
				'error',
				{
					roots: ['src', 'scripts'],
					contracts: [
						'scripts/avatar-inline-route.contract.test.ts',
						'scripts/env-schema-parity.contract.test.ts',
						'scripts/security-headers-sync.contract.test.ts',
						'scripts/upstream-report-scope.contract.test.ts'
					]
				}
			]
		}
	},
	// Tolgee() is TolgeeCore() plus the browser-extension plugin, whose handshake
	// retries outlive unmount and stop() and then read `window` after Vitest has
	// removed the jsdom globals.
	// A lazy import.meta.glob map, such as convex-test's modules, imports on first
	// use, so the first test pays the cold transform and can time out under load.
	{
		files: ['src/**/*.test.ts', 'src/**/test-fixtures/**'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector: 'CallExpression[callee.name="Tolgee"]',
					message: 'Use TolgeeCore() in tests; Tolgee() adds the browser-extension handshake.'
				},
				{
					selector:
						'CallExpression[callee.object.type="MetaProperty"][callee.property.name="glob"]:not(CallExpression[callee.name="preloadModules"] > CallExpression)',
					message:
						'Wrap import.meta.glob in `await preloadModules(...)` from src/lib/confect/convexTest.modules.ts, and pass `convexModules` to convexTest: a lazy map imports inside the first test that calls it, where a cold transform can pass the test timeout.'
				}
			]
		}
	},
	{
		files: ['**/*.{js,mjs,cjs,ts,svelte}'],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/effect-subpath-import': ['error', { files: ['src/**', 'scripts/**'] }],
			'local/effect-run-boundary': [
				'error',
				{
					files: ['src/**', 'scripts/**'],
					allow: [
						'src/lib/effect/client-runtime.ts',
						'src/lib/effect/lifetime.ts',
						'src/lib/server/effect-runtime.ts',
						'**/*.{test,spec}.ts'
					]
				}
			],
			'local/effect-no-raw-timers': [
				'error',
				{ files: ['src/lib/effect/**'], allow: ['**/*.{test,spec}.ts'] }
			],
			'local/effect-no-promise-race': ['error', { files: ['src/lib/effect/**'] }],
			'local/effect-tagged-errors': ['error', { files: ['src/lib/effect/**'] }],
			'local/effect-no-try-in-gen': ['error', { files: ['src/lib/effect/**'] }],
			'local/effect-no-manual-retry': ['error', { files: ['src/lib/effect/**'] }],
			'local/effect-leaf-imports': ['error', { files: EFFECT_LEAF_MODULES }]
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
	// Convex best-practice rules; v2 ships an ESLint 9 flat config
	...convexPlugin.configs.recommended.map((config) => ({
		...config,
		files: convexRuntimeFiles
	})),
	{
		files: convexRuntimeFiles,
		rules: {
			// An unbounded read fails once it crosses the 16 MiB / 32k-row transaction limit.
			'@convex-dev/no-collect-in-query': 'error'
		}
	},
	// Anyone on the internet can call a public query, mutation or action, so its
	// handler completes an access call before any effect, and every registration
	// keeps the form the access rules can read. See eslint/rules/convex-access-first.js and
	// eslint/rules/convex-canonical-registration.js.
	{
		files: convexRuntimeFiles,
		ignores: Object.keys(PLAIN_REGISTRATION_PATHS),
		plugins: {
			local: localPlugin
		},
		rules: {
			'@convex-dev/require-access-control': ['error', { pattern: convexAccessPattern }],
			'local/convex-access-first': [
				'error',
				{
					pattern: convexAccessPattern,
					synchronous: ['requireTestSecret'],
					middleware: ['RequireUser', 'RequireAdmin', 'VisitorAccess'],
					public: CONFECT_PUBLIC_FUNCTIONS
				}
			],
			'local/convex-effect-query-safety': 'error'
		}
	},
	{
		files: ['src/**/*.ts', 'src/**/*.js', 'src/**/*.svelte'],
		ignores: Object.keys(PLAIN_REGISTRATION_PATHS),
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/convex-canonical-registration': [
				'error',
				{
					libraryFunctions: Object.values(CONFECT_LIBRARY_FUNCTIONS).flat(),
					httpRoutes: Object.keys(PLAIN_HTTP_ROUTES)
				}
			]
		}
	},
	{
		files: ['src/lib/confect/**/*.ts'],
		ignores: [
			'src/lib/confect/_generated/**',
			'src/lib/confect/crons.ts',
			'src/lib/confect/http.ts',
			'**/*.spec.ts',
			'**/*.impl.ts',
			'**/*.test.ts',
			'**/__tests__/**'
		],
		plugins: {
			local: localPlugin
		},
		rules: {
			'local/confect-definition-imports': 'error'
		}
	},
	{
		// Convex runs queries and mutations with dynamic imports disabled, while
		// Node tests run them fine, so only the deployed function fails.
		files: convexRuntimeFiles,
		ignores: ['**/*.test.ts', '**/__tests__/**', '**/*.fixtures.ts'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector: 'ImportExpression',
					message:
						'Convex rejects `import()` in queries and mutations ("dynamic module import unsupported"). Import statically, or put the dependency in its own function and call it by reference. Code that only actions run may disable this with the reason.'
				},
				{
					// A caught error from Better Auth, Autumn, Resend or an LLM provider
					// quotes the input it rejected or the provider's response body.
					selector:
						"CatchClause CallExpression[callee.object.name='console'] Identifier[name=/^(e|err|error)$/]:not(MemberExpression > Identifier.property, Property > Identifier.key)",
					message:
						"Log a caught error as `console.error({ code: 'snake_case_code', ...ids })` without the error itself: its message can quote emails, tokens or provider response bodies into the Convex logs."
				},
				{
					// One counter row patched per sign-up lets a burst of concurrent sign-ups
					// exhaust Convex's conflict retries (FAILED_TO_CREATE_USER).
					selector:
						"CallExpression[callee.property.name='first'] > MemberExpression > CallExpression[callee.property.name='query'][arguments.0.value='dashboardCounters']",
					message:
						"dashboardCounters is sharded: `.first()` returns one arbitrary shard. Write through `incrementCounter`, which reads one shard via `withIndex('by_shard')`, and read totals with `getCounters`."
				}
			]
		}
	},
	// Generated by the Better Auth CLI and owned upstream; its duplicate indexes
	// are not ours to remove.
	{
		files: ['src/lib/convex-components/betterAuth/schema.ts'],
		rules: {
			'@convex-dev/no-duplicate-indexes': 'off'
		}
	}
);
