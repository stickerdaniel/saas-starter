import svelte from 'eslint-plugin-svelte';

// Use the parser supplied by our declared plugin, just as the real lint config does.
// Do not rely on an undeclared transitive svelte-eslint-parser installation.
function getSvelteParser() {
	const parser = svelte.configs.base.find((config) => config.languageOptions?.parser)
		?.languageOptions?.parser;
	if (!parser || !('parseForESLint' in parser) || typeof parser.parseForESLint !== 'function') {
		throw new Error('The Svelte ESLint plugin must provide its parseForESLint parser');
	}
	return parser;
}

export default getSvelteParser();
