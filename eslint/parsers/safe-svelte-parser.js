import * as svelteParser from 'svelte-eslint-parser';
import { sanitizeDiagnosticText } from '../control-character-policy.js';

/**
 * Keep parser failures safe for terminal and CI output.
 *
 * A malformed Svelte expression can make `svelte-eslint-parser` quote its invalid
 * token before any ESLint rule visitor runs. If that token is a control or bidi
 * character, the normal rule has no chance to replace it with a codepoint before
 * the formatter prints it. The wrapper changes only the thrown message and keeps
 * every location and parser service on the original parser.
 *
 * Valid files take the direct path, so HTML and JavaScript ESLint directives,
 * autofixes, source maps and the normal rule visitor all retain their native
 * behavior.
 */
function parseForESLint(code, options) {
	try {
		return svelteParser.parseForESLint(code, options);
	} catch (error) {
		if (error && typeof error === 'object' && typeof error.message === 'string') {
			error.message = sanitizeDiagnosticText(error.message);
		}
		throw error;
	}
}

export default {
	meta: svelteParser.meta,
	parseForESLint
};
