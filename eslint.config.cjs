const globals = require('globals');
const tsParser = require('@typescript-eslint/parser');
const js = require('@eslint/js');

const { FlatCompat } = require('@eslint/eslintrc');

const compat = new FlatCompat({
	baseDirectory: __dirname,
	recommendedConfig: js.configs.recommended,
	allConfig: js.configs.all
});

module.exports = [
	// Global ignores - must be first!
	{
		ignores: [
			'**/.eslintrc.cjs',
			'**/eslint.config.cjs', // Ignore this config file itself
			'**/test/**',
			'**/docs/**',
			'**/dist/**',
			'**/.svelte-kit/**',
			'**/build/**',
			'**/node_modules/**',
			'test-nextjs/backendHarness.js',
			'**/e2e/**', // Ignore e2e tests (not in tsconfig)
			'playwright.config.ts', // Ignore playwright config (not in tsconfig)
			'**/*.svelte', // Temporarily ignore Svelte files until proper setup
			'**/src/lib/convex/_generated/**' // Ignore generated files
		]
	},

	// Basic ESLint recommended for all JS files
	...compat.extends('eslint:recommended').map((config) => ({
		...config,
		files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
		languageOptions: {
			...config.languageOptions,
			globals: {
				...globals.browser,
				...globals.node,
				...globals.es2020
			}
		}
	})),

	// TypeScript configuration with type checking
	...compat
		.extends('eslint:recommended', 'plugin:@typescript-eslint/recommended-type-checked')
		.map((config) => ({
			...config,
			files: ['**/*.ts'],
			languageOptions: {
				...config.languageOptions,
				globals: {
					...globals.browser,
					...globals.node,
					...globals.es2020
				},
				parser: tsParser,
				parserOptions: {
					project: true,
					tsconfigRootDir: __dirname
				}
			}
		})),

	{
		files: ['**/*.ts'],
		rules: {
			// All of these overrides ease getting into
			// TypeScript, and can be removed for stricter
			// linting down the line.

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

			// Allow explicit `any`s
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			// END: Allow implicit `any`s

			// Allow async functions without await
			// for consistency (esp. Convex `handler`s)
			'@typescript-eslint/require-await': 'off',

			// Allow non-Error promise rejections (common in web APIs)
			'@typescript-eslint/prefer-promise-reject-errors': 'off',

			// Allow await on non-Promise values (Convex queries can be non-Promise)
			'@typescript-eslint/await-thenable': 'off',

			// Disable import rules that don't exist
			'import/no-anonymous-default-export': 'off'
		}
	}
];
