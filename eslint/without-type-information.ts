import type { Linter } from 'eslint';

/**
 * Application-config ESLint override for tests that assert a rule's verdict.
 *
 * `eslint.config.js` gives Svelte files `project: true`, so the first Svelte file a
 * process lints builds the type-checked program for the whole repository. That cold
 * start takes tens of seconds and stretches with machine load past the test timeout.
 * Pass this as `overrideConfig` to keep the application's files, parsers, processors
 * and rules without that program. Tests of type-aware linting itself leave it out.
 */
export const withoutTypeInformation: Linter.Config = {
	languageOptions: { parserOptions: { project: false } }
};
