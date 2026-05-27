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

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');
const localPlugin = {
	rules: {
		'require-marketing-markdown': requireMarketingMarkdownRule,
		'require-marketing-route-registration': requireMarketingRouteRegistrationRule,
		'no-hardcoded-aria-label': noHardcodedAriaLabelRule,
		'no-hardcoded-sr-only': noHardcodedSrOnlyRule,
		'no-debounce-in-rune': noDebounceInRuneRule
	}
};

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// Ignore auto-generated files
	{
		ignores: ['**/_generated/**', 'src/env.d.ts', 'src/lib/convex/convex-env.d.ts']
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
		rules: {
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
			'local/no-hardcoded-sr-only': 'error'
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
	// Convex best-practice rules — v2 ships ESLint 9 flat config natively
	...convexPlugin.configs.recommended.map((config) => ({
		...config,
		files: ['**/src/lib/convex/**/*.ts']
	}))
);
