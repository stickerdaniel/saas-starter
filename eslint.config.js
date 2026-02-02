import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	// Ignore auto-generated Convex files
	{
		ignores: ['**/_generated/**']
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

			// Allow explicit `any`s
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',

			// Allow async functions without await (for Convex handlers)
			'@typescript-eslint/require-await': 'off',

			// Allow non-Error promise rejections (common in web APIs)
			'@typescript-eslint/prefer-promise-reject-errors': 'off',

			// Allow await on non-Promise values (Convex queries can be non-Promise)
			'@typescript-eslint/await-thenable': 'off'
		}
	},
	// No console.log/debug/info in src/ (frontend code)
	{
		files: ['src/**/*.{ts,js,svelte}'],
		ignores: ['src/lib/convex/**'],
		rules: {
			'no-console': ['error', { allow: ['warn', 'error'] }]
		}
	}
);
