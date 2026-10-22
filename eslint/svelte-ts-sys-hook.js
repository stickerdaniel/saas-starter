/**
 * Opt into svelte-eslint-parser's `ts.sys.readFile` hook for ESLint runs of this config.
 *
 * With `parserOptions.project`, typescript-eslint reads each `.svelte` file from disk as
 * raw markup, sees that it differs from the virtual TypeScript it is asked to lint, and
 * rebuilds the program and type checker for every Svelte file. The hook makes the disk
 * read return that same virtual TypeScript, so one checker serves the whole run.
 *
 * The parser reads the flag once, when it is first imported, so `eslint.config.js` must
 * import this module before anything that loads the parser. A process that imported the
 * parser before this config, such as a parser rule test, runs without the hook. Setting
 * it here rather than in a script covers the CLI, `bun run lint`, the checker, and
 * editors on every platform.
 */
process.env.SVELTE_ESLINT_PARSER_EXPERIMENTAL_TS_SYS_HOOK = '1';
