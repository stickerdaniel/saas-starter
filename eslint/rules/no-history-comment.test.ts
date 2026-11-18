import { Linter } from 'eslint';
import svelteParser from 'svelte-eslint-parser';
import { parser as tsParser } from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import rule from './no-history-comment.js';

const linter = new Linter({ configType: 'flat' });
const config = [
	{ plugins: { local: { rules: { 'no-history-comment': rule } } } },
	{ files: ['**/*.ts'], languageOptions: { parser: tsParser } },
	{ files: ['**/*.svelte'], languageOptions: { parser: svelteParser } },
	{ files: ['**/*'], rules: { 'local/no-history-comment': 'error' as const } }
];

function lint(code: string, filename: string) {
	return linter.verify(code, config, { filename }).map(({ ruleId, line, message }) => ({
		ruleId,
		line,
		message
	}));
}

const historySentence = 'We tried a retry here, which did not work.';

describe('no-history-comment', () => {
	it.each([
		['a TypeScript line comment', `const a = 1;\n// ${historySentence}\n`, 'src/lib/x.ts', 2],
		[
			'an authored rule file',
			`/**\n * ${historySentence}\n */\nexport default {};\n`,
			'eslint/rules/x.js',
			1
		],
		[
			'a Svelte markup comment',
			`<div></div>\n<!-- ${historySentence} -->\n`,
			'src/lib/x.svelte',
			2
		],
		[
			'a Svelte script comment',
			`<script lang="ts">\n\t// ${historySentence}\n\tlet a = 1;\n</script>\n`,
			'src/lib/x.svelte',
			2
		]
	])('reports the sentence in %s', (_label, code, filename, line) => {
		const messages = lint(code, filename);
		expect(messages).toEqual([
			expect.objectContaining({ ruleId: 'local/no-history-comment', line })
		]);
	});

	it.each([
		['we tried', '// We tried the cache first.'],
		["didn't work", "// The old key didn't work."],
		['the review found', '/* The review found a race here. */'],
		['the audit caught', '// The audit caught a leak.'],
		['before this change', '// Before this change the queue grew.'],
		['fixed in #N', '// Fixed in #123.'],
		['regressed in #N', '// Regressed in #45.']
	])('reports "%s"', (_phrase, comment) => {
		expect(lint(`${comment}\nexport {};\n`, 'src/lib/x.ts')).toEqual([
			expect.objectContaining({ ruleId: 'local/no-history-comment', line: 1 })
		]);
	});

	it('reads adjacent line comments as one block', () => {
		const messages = lint(
			'// The first attempt did\n// not work under load.\nexport {};\n',
			'src/lib/x.ts'
		);
		expect(messages).toHaveLength(1);
		expect(messages[0].line).toBe(1);
	});

	it('leaves the sentence alone in a string literal', () => {
		expect(lint(`export const note = '${historySentence}';\n`, 'src/lib/x.ts')).toEqual([]);
	});

	// Comments that describe runtime state, taken from a calibration over 200 merged PRs.
	it.each([
		'// Taken out of Play on purpose, the map is no longer waiting for its first\n// start, and a step Daphne starts meanwhile must not switch the mode back.',
		'/**\n * The longest prefix of `text` that `fits` with its cut marker, or `text` when\n * it fits whole. `maxChars` bounds the search for a caller that knows no longer\n * prefix can fit.\n */',
		'// #sendFrame drops the frame once origin.socket is no longer the live one.',
		'/**\n * `page.url` keeps the parameter until the next navigation, so code that builds\n * URLs from it must drop `voice` when the address bar no longer has it.\n */',
		"// The marker is part of the matrix's meaning, so the map built before it no\n// longer feeds MCL, and a new map can be built at once.",
		'// The refusal advances the epoch,\n// so that probe\'s "free" no longer unlocks writing (probeVoiceOwnershipOnce).',
		'/**\n * An attempt known never to have been sent is sent again only once the session\n * that rejected it no longer holds the chat: that session would reject it again.\n */',
		'// A replay finds the cause on its turn after the first attempt used it up.',
		'// One searchable entry for the key: the earlier version went with the new one.',
		'// Unstaged: the index still lists blocked/inner.txt, which no longer exists on disk.',
		'// The line keeps the text nobody heard, under the session it was dropped in.',
		'// The first attempt reaches the backend and its answer is lost.'
	])('passes the runtime-state comment %#', (comment) => {
		expect(lint(`${comment}\nexport {};\n`, 'src/lib/x.ts')).toEqual([]);
	});
});
