import base from '../eslint.config.js';
import { shadcnPolicy } from './shadcn-policy.js';

// Parser-only scan for the interim shadcn baseline gate (scripts/shadcn-baseline.ts).
//
// Every application entry is kept, so global ignores, parsers (including the safe
// Svelte wrapper), processors, plugins and settings stay exactly those of
// eslint.config.js. Only rule tables are emptied. An entry keeps an empty `rules`
// object rather than losing the key: an entry left with nothing but `ignores` would
// turn into a global ignore. The typed project service is switched off because none
// of the shadcn rules read type information, and it multiplies time and memory.
export default [
	...base.map((entry) => (entry.rules ? { ...entry, rules: {} } : entry)),
	{
		files: shadcnPolicy.files,
		languageOptions: { parserOptions: { projectService: false, project: false } },
		linterOptions: { reportUnusedDisableDirectives: 'off' }
	},
	shadcnPolicy
];
