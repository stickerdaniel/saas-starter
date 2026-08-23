import { describe, expect, it } from 'vitest';
import rule from './no-literal-control-char.js';

/**
 * Every offending character below is built with `fromCharCode`. Spelling one
 * literally would put the very bytes this rule bans into its own guard, which is
 * the mistake the rule exists to catch, and it would make this file's diffs
 * unreviewable the moment the guard failed.
 */
const char = (code: number) => String.fromCharCode(code);

interface Report {
	loc: { line: number; column: number };
	messageId: string;
	data: { codepoint: string; category: string; escape: string };
}

function lint(code: string): Report[] {
	const reports: Report[] = [];
	const context = {
		report: (opts: Report) => reports.push(opts),
		sourceCode: { getText: () => code }
	};
	const listeners = rule.create(context) as Record<string, () => void>;
	listeners.Program();
	return reports;
}

describe('no-literal-control-char', () => {
	it.each([
		['NUL', 0x00, 'C0 control'],
		['SOH', 0x01, 'C0 control'],
		['VT', 0x0b, 'C0 control'],
		['FF', 0x0c, 'C0 control'],
		['ESC', 0x1b, 'C0 control'],
		['DEL', 0x7f, 'DEL']
	])('flags a literal %s and names its codepoint', (_label, code, category) => {
		const reports = lint(`const key = a + '${char(code)}' + b;`);
		expect(reports).toHaveLength(1);
		expect(reports[0].messageId).toBe('literalControlChar');
		expect(reports[0].data.category).toBe(category);
		expect(reports[0].loc).toEqual({ line: 1, column: 17 });
	});

	// U+001F is the last C0 control and U+0020 the first printable character, so a
	// boundary written as `<` or `<=` lands here and nowhere else.
	it('flags U+001F and leaves the space beside it alone', () => {
		expect(lint(`a${char(0x1f)}b`)).toHaveLength(1);
		expect(lint(`a${char(0x20)}b`)).toHaveLength(0);
	});

	// C1 controls are as invisible as C0 and survive a round trip through UTF-8, so a
	// scan that stops at DEL passes them through.
	it.each([
		['U+0080', 0x80],
		['U+0085', 0x85],
		['U+009F', 0x9f]
	])('flags the C1 control %s', (_label, code) => {
		const reports = lint(`const a = '${char(code)}';`);
		expect(reports).toHaveLength(1);
		expect(reports[0].data.category).toBe('C1 control');
	});

	it('leaves the printable characters either side of the C1 block alone', () => {
		expect(lint(`a${char(0x7e)}b`)).toHaveLength(0);
		expect(lint(`a${char(0xa0)}b`)).toHaveLength(0);
	});

	// These reorder how the source displays without changing what it runs, which is
	// the Trojan Source attack (CVE-2021-42574). Invisibility is the lesser problem.
	it.each([
		['ALM', 0x061c],
		['LRM', 0x200e],
		['RLM', 0x200f],
		['LRE', 0x202a],
		['RLO', 0x202e],
		['LRI', 0x2066],
		['PDI', 0x2069]
	])('flags the bidirectional character %s', (_label, code) => {
		const reports = lint(`const a = '${char(code)}';`);
		expect(reports).toHaveLength(1);
		expect(reports[0].data.category).toBe('bidirectional formatting');
	});

	it('flags exactly the characters Unicode gives the Bidi_Control property', () => {
		const reported: number[] = [];
		const unicode: number[] = [];
		for (let code = 0; code <= 0xffff; code++) {
			const value = String.fromCharCode(code);
			if (lint(value).some((report) => report.data.category === 'bidirectional formatting')) {
				reported.push(code);
			}
			if (/\p{Bidi_Control}/u.test(value)) unicode.push(code);
		}
		expect(reported).toEqual(unicode);
		expect(unicode).toHaveLength(12);
	});

	it('leaves the printable characters either side of the bidi ranges alone', () => {
		expect(lint(`a${char(0x061b)}b`)).toHaveLength(0);
		expect(lint(`a${char(0x061d)}b`)).toHaveLength(0);
		expect(lint(`a${char(0x200d)}b`)).toHaveLength(0);
		expect(lint(`a${char(0x2010)}b`)).toHaveLength(0);
		expect(lint(`a${char(0x2065)}b`)).toHaveLength(0);
		expect(lint(`a${char(0x206a)}b`)).toHaveLength(0);
	});

	// Inside a string or template literal an escape keeps the runtime value while making
	// the source visible. Between tokens the right repair is ordinary whitespace, which
	// is why the rule deliberately has no fixer.
	it.each(['\\u0000', '\\u0001', '\\0', '\\x00', '\\u202E'])('allows the escape %s', (escape) => {
		expect(lint(`const key = a + '${escape}' + b;`)).toHaveLength(0);
	});

	// Source is made of these. Flagging them would flag every file and the rule would
	// be switched off the same day.
	it.each([
		['tab', 0x09],
		['newline', 0x0a],
		['carriage return', 0x0d]
	])('leaves %s alone', (_label, code) => {
		expect(lint(`const a = 1;${char(code)}const b = 2;`)).toHaveLength(0);
	});

	// One report per character, not one per file. A file that lost its escapes in a
	// bad merge should name every place a fix is needed.
	it('reports every offender rather than stopping at the first', () => {
		expect(lint(`a${char(0x01)}b${char(0x00)}c`)).toHaveLength(2);
	});

	// The column is what makes the report actionable, since the character shows the
	// reader nothing and the line looks correct.
	it('counts lines and restarts the column after each newline', () => {
		const reports = lint(`const a = 1;\nconst b = '${char(0x1b)}';`);
		expect(reports).toHaveLength(1);
		expect(reports[0].loc).toEqual({ line: 2, column: 11 });
	});

	// A CRLF file must not shift every column on the following line by one, and it
	// must not count the pair as two lines either.
	it('does not let a carriage return consume the newline', () => {
		const reports = lint(`const a = 1;\r\n${char(0x1b)}`);
		expect(reports).toHaveLength(1);
		expect(reports[0].loc).toEqual({ line: 2, column: 0 });
	});

	// ESLint treats all four of these as line terminators. Counting only the line
	// feed reported the character a line early, and an `eslint-disable-next-line`
	// written against the reported line then landed on the wrong one.
	it.each([
		['a lone carriage return', 0x0d],
		['a line separator', 0x2028],
		['a paragraph separator', 0x2029]
	])('starts a new line after %s', (_label, terminator) => {
		const reports = lint(`const a = 1;${char(terminator)}${char(0x1b)}`);
		expect(reports).toHaveLength(1);
		expect(reports[0].loc).toEqual({ line: 2, column: 0 });
	});

	// The message carries the codepoint and the escape to write instead. It must
	// never quote the source: the character would show nothing, and an ESC pasted
	// into a terminal reprograms it.
	it('names the codepoint and the escape without quoting the source', () => {
		const reports = lint(`const a = '${char(0x1b)}';`);
		expect(reports[0].data.codepoint).toBe('U+001B');
		expect(reports[0].data.escape).toBe('\\u001B');
		expect(rule.meta.messages.literalControlChar).not.toContain('{{source}}');
		expect(rule.meta.messages.literalControlChar).toContain('visible whitespace');
		expect(rule.meta.messages.literalControlChar).toContain('inside a string or template literal');
	});
});
