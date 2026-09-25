import { describe, expect, it } from 'vitest';
import {
	REFERENCE_DEFINITION,
	extractMarkdownLinks,
	parseFlatFrontmatter,
	resolveRelativeLink
} from './markdown';

describe('parseFlatFrontmatter', () => {
	it('parses flat quoted and unquoted fields with line numbers', () => {
		expect(
			parseFlatFrontmatter('---\r\ntype: decision\r\nstatus: "historical"\r\n---\r\n')
		).toEqual({
			present: true,
			fields: {
				type: { value: 'decision', line: 2 },
				status: { value: 'historical', line: 3 }
			},
			errors: []
		});
	});

	it('reports unsupported structures, duplicate keys, and missing delimiters', () => {
		const parsed = parseFlatFrontmatter('---\ntype: decision\ntype: duplicate\ntags: [a, b]\n');
		expect(parsed.errors.map((error) => error.message)).toEqual([
			'Duplicate frontmatter key "type".',
			'Frontmatter arrays and objects are not supported.',
			'Frontmatter is missing its closing delimiter.'
		]);
	});

	it('distinguishes a file without frontmatter', () => {
		expect(parseFlatFrontmatter('# Document')).toEqual({ present: false, fields: {}, errors: [] });
	});
});

describe('extractMarkdownLinks', () => {
	it('extracts inline, titled, angle, balanced, and reference links', () => {
		const links = extractMarkdownLinks(`
[plain](docs/plain.md)
[titled](docs/titled.md "Title")
[angle](<docs/path with spaces.md>)
[balanced](docs/example_(old).md)
[full][guide] [collapsed][] [shortcut]

[guide]: docs/guide.md
[collapsed]: docs/collapsed.md
[shortcut]: docs/shortcut.md
`);
		expect(links).toEqual([
			{ target: 'docs/plain.md', line: 2 },
			{ target: 'docs/titled.md', line: 3 },
			{ target: 'docs/path with spaces.md', line: 4 },
			{ target: 'docs/example_(old).md', line: 5 },
			{ target: 'docs/guide.md', line: 6 },
			{ target: 'docs/collapsed.md', line: 6 },
			{ target: 'docs/shortcut.md', line: 6 }
		]);
	});

	it('ignores code, external URLs, fragments, and root-relative routes', () => {
		const links = extractMarkdownLinks(`
\`[inline](missing.md)\`

\`\`\`md
[fenced](missing.md)
\`\`\`

[http](https://example.com) [mail](mailto:a@example.com) [fragment](#x) [route](/app)
[relative](docs/real.md?view=1#part)
`);
		expect(links).toEqual([
			{ target: 'https://example.com', line: 8 },
			{ target: 'mailto:a@example.com', line: 8 },
			{ target: '#x', line: 8 },
			{ target: '/app', line: 8 },
			{ target: 'docs/real.md?view=1#part', line: 9 }
		]);
	});
});

describe('REFERENCE_DEFINITION', () => {
	// Reference only: the ambiguous destination group CodeQL flagged as js/redos.
	const previous =
		/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|((?:\\.|[^\s])+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/;

	function* strings(alphabet: readonly string[], maxLength: number): Generator<string> {
		let level = [''];
		for (let length = 1; length <= maxLength; length += 1) {
			level = level.flatMap((prefix) => alphabet.map((char) => prefix + char));
			yield* level;
		}
	}

	it('rejects a long backslash run in linear time', () => {
		const line = `[a]: ${'\\'.repeat(40)} x y`;
		const started = performance.now();
		expect(extractMarkdownLinks(`${line}\n[b][a]`)).toEqual([]);
		expect(performance.now() - started).toBeLessThan(100);
	});

	it('captures the same definitions as the ambiguous previous pattern', () => {
		const samples = [
			'[a]: docs/guide.md',
			'  [Guide Name]: ../docs/guide.md#part "Title"',
			"[a]: docs/guide.md 'Title'",
			'[a]: docs/guide.md (Title)',
			'[a]: docs/guide.md "Title with spaces"   ',
			'[a]: <docs/path with spaces.md>',
			'[a]: <x y> "Title"',
			'[a]: foo\\ bar',
			'[a]: foo\\ bar "Title"',
			'[a]: foo\\',
			'[a]: foo\\ ',
			'[a]: \\',
			'[a]: foo\\ "a b"',
			'[a]: docs/\\(escaped\\)\\[chars\\].md',
			'[a]: C:\\\\docs\\\\guide.md',
			'[a]: foo "unterminated',
			'    [a]: indented/code.md',
			'[a]:',
			...Array.from(
				strings(['a', '\\', ' ', '"', "'", '<', '>', '('], 5),
				(destination) => `[a]: ${destination}`
			)
		];
		for (const sample of samples) {
			const expected = sample.match(previous);
			// The previous pattern also read `\\` plus whitespace as a lone backslash
			// before an escaped space. CommonMark ends the destination there instead.
			if (expected?.[3] && /(?<!\\)(?:\\\\)+\s/.test(expected[3])) continue;
			expect(sample.match(REFERENCE_DEFINITION), sample).toEqual(expected);
		}
	});
});

describe('resolveRelativeLink', () => {
	it('resolves repository-relative paths and strips query and fragment', () => {
		expect(
			resolveRelativeLink('docs/README.md', { target: '../src/file.ts?x=1#L2', line: 1 })
		).toEqual({
			target: 'src/file.ts',
			outsideRepository: false
		});
	});

	it('marks links that escape the repository', () => {
		expect(resolveRelativeLink('README.md', { target: '../outside.md', line: 1 })).toEqual({
			target: '../outside.md',
			outsideRepository: true
		});
	});

	it.each(['https://example.com', '//example.com', '#part', '/app'])('ignores %s', (target) => {
		expect(resolveRelativeLink('README.md', { target, line: 1 })).toBeNull();
	});
});
