import { lex } from 'svelte-streamdown';
import { describe, expect, it } from 'vitest';
import {
	askUntilValid,
	escapeMarkdownInline,
	githubSlugProperty,
	isValidGithubRepository,
	isValidWorkerSlug,
	parseContactEmail,
	readmeShowsCompletedSetup,
	replaceGithubSlugSource,
	replaceLegalConfigSource,
	replaceLegalContentDatesSource,
	replaceLockRootNameSource,
	replaceReadmeSource,
	replaceWranglerNameSource,
	serializeConfigValue,
	tsStringLiteral,
	updateLegalContentDatesSource
} from './template-setup';

function asciiDomainOfLength(length: number): string {
	const labels: string[] = [];
	let remaining = length;
	while (remaining > 63) {
		labels.push('a'.repeat(63));
		remaining -= 64;
	}
	labels.push('a'.repeat(remaining));
	return labels.join('.');
}

describe('template setup repository configuration', () => {
	it.each([
		'owner/repo',
		'owner-name/repo.name',
		'Owner123/repo_name',
		`owner/${'r'.repeat(100)}`,
		'owner/com0',
		'owner/com10',
		'owner/lpt0',
		'owner/lpt10',
		'owner/console'
	])('accepts %s', (value) => {
		expect(isValidGithubRepository(value)).toBe(true);
	});

	it.each([
		'owner',
		'owner/repo/extra',
		'owner/repo"; console.log(1)',
		'owner name/repo',
		'owner-/repo',
		'owner--name/repo',
		'owner/repository.git',
		'owner/project.',
		`${'a'.repeat(40)}/repo`,
		`owner/${'r'.repeat(101)}`,
		'/repo',
		'owner/.',
		'owner/..',
		...[
			'con',
			'prn',
			'aux',
			'nul',
			...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
			...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)
		].flatMap((basename) => [`owner/${basename}`, `owner/${basename.toUpperCase()}.project`])
	])('rejects unsafe repository value %s', (value) => {
		expect(isValidGithubRepository(value)).toBe(false);
		expect(() => githubSlugProperty(value)).toThrow(/Invalid GitHub repository/);
	});

	it('updates the central slug and is idempotent', () => {
		const source = "export const SITE_CONFIG = {\n\tgithubSlug: 'old-owner/old-repo'\n};\n";
		const first = replaceGithubSlugSource(source, 'new-owner/new-repo');
		const second = replaceGithubSlugSource(first, 'new-owner/new-repo');

		expect(first).toContain("githubSlug: 'new-owner/new-repo'");
		expect(second).toBe(first);
	});

	it('fails when the configuration shape has drifted', () => {
		expect(() => replaceGithubSlugSource('export const SITE_CONFIG = {};', 'owner/repo')).toThrow(
			/Could not find githubSlug/
		);
	});

	it('replaces only the direct property in the SITE_CONFIG initializer', () => {
		const source = `// githubSlug: 'comment/line'
export interface SiteConfig {
	/** Example: githubSlug: 'comment/doc' */
	githubSlug: \`${'${string}/${string}'}\`;
}

const example = "githubSlug: 'string/example'";
export const SITE_CONFIG = {
	/*
	 * githubSlug: 'comment/block'
	 */
	githubSlug: 'old-owner/old-repo', // githubSlug: 'comment/trailing'
	structuredData: {}
};
`;

		const updated = replaceGithubSlugSource(source, 'new-owner/new-repo');
		expect(updated).toContain(
			"githubSlug: 'new-owner/new-repo', // githubSlug: 'comment/trailing'"
		);
		expect(updated).toContain("githubSlug: 'comment/block'");
		expect(updated).toContain("githubSlug: 'string/example'");
	});

	it('fails for duplicate or unsupported direct githubSlug properties', () => {
		expect(() =>
			replaceGithubSlugSource(
				"export const SITE_CONFIG = { githubSlug: 'owner/one', githubSlug: 'owner/two' };",
				'new-owner/new-repo'
			)
		).toThrow(/Expected exactly one direct githubSlug property/);
		expect(() =>
			replaceGithubSlugSource(
				'export const SITE_CONFIG = { githubSlug: repository };',
				'new-owner/new-repo'
			)
		).toThrow(/direct string literal/);
	});
});

describe('template setup worker slug', () => {
	it('accepts the 63-character boundary', () => {
		expect(isValidWorkerSlug('n'.repeat(63))).toBe(true);
	});

	it.each(['-northwind', 'northwind-', 'n'.repeat(64)])('rejects %s', (value) => {
		expect(isValidWorkerSlug(value)).toBe(false);
	});
});

describe('template setup legal dates', () => {
	const source = `export const LEGAL_CONTENT_DATES = {
	privacy: '2026-03-18',
	terms: '2026-03-18',
	impressum: '2026-03-21'
} as const;`;

	it('dates every rewritten legal document with the setup date', () => {
		const updated = replaceLegalContentDatesSource(source, '2026-08-24');
		expect(updated.match(/2026-08-24/g)).toHaveLength(3);
	});

	it('updates only direct properties in the exported initializer', () => {
		const misleadingSource = `// impressum: '1999-01-01'
export const LEGAL_CONTENT_DATES = {
	privacy: '2026-03-18',
	terms: '2026-03-18',
	// impressum: '2000-01-01'
	impressum: "2026-03-21"
} as const;

const example = { impressum: '2001-01-01' };`;
		const updated = replaceLegalContentDatesSource(misleadingSource, '2026-08-24');

		expect(updated).toContain("// impressum: '1999-01-01'");
		expect(updated).toContain("// impressum: '2000-01-01'");
		expect(updated).toContain("const example = { impressum: '2001-01-01' };");
		expect(updated).toContain('impressum: "2026-08-24"');
		expect(updated.match(/2026-08-24/g)).toHaveLength(3);
	});

	it('preserves legal dates when the legal identity is unchanged', () => {
		expect(updateLegalContentDatesSource(source, '2026-08-24', false)).toBe(source);
	});

	it('validates every direct property even when no date changes are needed', () => {
		const missing = source.replace("impressum: '2026-03-21'", '');
		expect(() => updateLegalContentDatesSource(missing, '2026-08-24', false)).toThrow(
			/Could not update every date/
		);
	});

	it('fails before writes when the metadata shape has drifted', () => {
		expect(() =>
			replaceLegalContentDatesSource(source.replace("impressum: '2026-03-21'", ''), '2026-08-24')
		).toThrow(/Could not update every date/);
	});
});

describe('template setup string literals', () => {
	// Erwartet wird der Literaltext Zeichen für Zeichen. Dass er beim Einlesen wieder
	// denselben Wert ergibt, prüft template-setup.integration.test.ts mit echtem Import.
	it.each([
		{ value: 'Plain Name', literal: "'Plain Name'" },
		// Prettier bevorzugt einfache Quotes und weicht nur aus, wenn das Escapes spart.
		{ value: "O'Connor Software", literal: '"O\'Connor Software"' },
		{ value: 'The "Blue Door" GmbH', literal: '\'The "Blue Door" GmbH\'' },
		{ value: 'Anne\\Marie Weber', literal: "'Anne\\\\Marie Weber'" },
		{ value: 'Hauptstrasse 5\n12345 Berlin', literal: "'Hauptstrasse 5\\n12345 Berlin'" },
		{ value: 'Tab\there', literal: "'Tab\\there'" },
		{
			value: "Ampersand $& Backref $1 Tick $` Quote $' Co",
			literal: '"Ampersand $& Backref $1 Tick $` Quote $\' Co"'
		},
		{ value: 'Mixed \\ and " and \'', literal: "'Mixed \\\\ and \" and \\''" }
	])('emits $literal for $value', ({ value, literal }) => {
		expect(tsStringLiteral(value)).toBe(literal);
	});
});

describe('template setup config serialization', () => {
	it('emits tab-indented TypeScript and keeps additional keys', () => {
		expect(
			serializeConfigValue({ brandName: 'Acme', email: { user: 'a' }, forkKey: 'kept' }, '')
		).toBe("{\n\tbrandName: 'Acme',\n\temail: {\n\t\tuser: 'a'\n\t},\n\tforkKey: 'kept'\n}");
	});

	it.each([
		['array', [1, 2]],
		['date', new Date('2026-09-06T00:00:00Z')],
		['map', new Map([['key', 'value']])],
		['set', new Set(['value'])],
		['regular expression', /value/],
		['class instance', new (class UnsupportedConfigValue {})()],
		['null-prototype object', Object.assign(Object.create(null), { key: 'value' })],
		['own __proto__ property', JSON.parse('{"__proto__":"value"}')]
	])('rejects an unsupported %s instead of losing data', (_label, value) => {
		expect(() => serializeConfigValue({ value }, '')).toThrow(/Unsupported LEGAL_CONFIG/);
	});

	it('keeps supported primitive values in ordinary data objects', () => {
		expect(serializeConfigValue({ text: 'value', count: 2, enabled: false }, '')).toBe(
			"{\n\ttext: 'value',\n\tcount: 2,\n\tenabled: false\n}"
		);
	});

	const source = `export const LEGAL_CONFIG = {
	brandName: 'SaaS Starter',
	email: {
		user: 'daniel'
	}
} as const;

export function helper(): string {
	return LEGAL_CONFIG.brandName;
}
`;

	it('replaces only the export block and preserves the helpers', () => {
		const updated = replaceLegalConfigSource(source, {
			brandName: "O'Connor & Co",
			email: { user: 'kontakt' }
		});

		expect(updated).toContain('brandName: "O\'Connor & Co"');
		expect(updated).toContain('export function helper(): string {');
		expect(updated).not.toContain("brandName: 'SaaS Starter'");
	});

	it('fails before writes when the export block is missing or ambiguous', () => {
		expect(() => replaceLegalConfigSource('export const OTHER = {};', { a: 'b' })).toThrow(
			/found 0/
		);
		expect(() => replaceLegalConfigSource(source + source, { a: 'b' })).toThrow(/found 2/);
	});
});

describe('template setup README', () => {
	const source = `# Ship SaaS faster

[![Badge](https://github.com/old-owner/old-repo/actions/badge.svg)](https://github.com/old-owner/old-repo/actions)

> [Live demo!](https://demo.example) The public demo covers the user-facing features.

## Quick Start

\`\`\`bash
gh repo create my-saas-product --template old-owner/old-repo --clone
cd my-saas-product
bun install
bun run dev
\`\`\`

Unrelated prose stays.
`;

	const options = {
		brand: 'Northwind Labs',
		repository: 'northwind/northwind-labs',
		oldGithubUrl: 'https://github.com/old-owner/old-repo',
		githubUrl: 'https://github.com/northwind/northwind-labs'
	};

	it('brands the heading, drops the demo, and explains the generated project', () => {
		const updated = replaceReadmeSource(source, options);

		expect(updated.split('\n')[0]).toBe('# Northwind Labs');
		expect(updated).not.toContain('Live demo!');
		expect(updated).toContain(
			'git clone https://github.com/northwind/northwind-labs.git\ncd ./northwind-labs\nbun install'
		);
		expect(updated).not.toContain('gh repo create');
		expect(updated).toContain('Unrelated prose stays.');
		expect(updated).toContain('https://github.com/northwind/northwind-labs/actions');
	});

	it('is idempotent and follows a later repository rename', () => {
		const once = replaceReadmeSource(source, options);
		expect(replaceReadmeSource(once, options)).toBe(once);

		const renamed = replaceReadmeSource(once, {
			brand: 'Northwind Labs',
			repository: 'northwind/northwind-cloud',
			oldGithubUrl: options.githubUrl,
			githubUrl: 'https://github.com/northwind/northwind-cloud'
		});
		expect(renamed).toContain(
			'git clone https://github.com/northwind/northwind-cloud.git\ncd ./northwind-cloud'
		);
		expect(renamed).not.toContain('northwind-labs');
	});

	it.each([
		{
			oldRepository: 'owner/app',
			repository: 'owner/app-cloud',
			relatedRepository: 'owner/app-tools'
		},
		{
			oldRepository: 'owner/app-tools',
			repository: 'owner/app',
			relatedRepository: 'owner/app-tools-extra'
		}
	])(
		'rewrites exact $oldRepository links without changing $relatedRepository',
		({ oldRepository, repository, relatedRepository }) => {
			const oldGithubUrl = `https://github.com/${oldRepository}`;
			const githubUrl = `https://github.com/${repository}`;
			const linkedSource = source
				.replaceAll(options.oldGithubUrl, oldGithubUrl)
				.replace(
					'Unrelated prose stays.',
					`${oldGithubUrl}\n${oldGithubUrl}/actions\n${oldGithubUrl}?tab=readme\n${oldGithubUrl}#readme\n${oldGithubUrl}.git\nhttps://github.com/${relatedRepository}`
				);
			const updated = replaceReadmeSource(linkedSource, {
				brand: 'Northwind Labs',
				repository,
				oldGithubUrl,
				githubUrl
			});

			expect(updated).toContain(`${githubUrl}\n`);
			expect(updated).toContain(`${githubUrl}/actions`);
			expect(updated).toContain(`${githubUrl}?tab=readme`);
			expect(updated).toContain(`${githubUrl}#readme`);
			expect(updated).toContain(`${githubUrl}.git`);
			expect(updated).toContain(`https://github.com/${relatedRepository}`);
		}
	);

	it('escapes a brand that would otherwise render as Markdown', () => {
		expect(escapeMarkdownInline('A *bold* [link]')).toBe('A \\*bold\\* \\[link\\]');
		expect(replaceReadmeSource(source, { ...options, brand: '*Star* Co' }).split('\n')[0]).toBe(
			'# \\*Star\\* Co'
		);
	});

	it('keeps a strikethrough-looking brand literal in the rendered heading', () => {
		const heading = replaceReadmeSource(source, { ...options, brand: '~~Northwind~~' }).split(
			'\n'
		)[0]!;
		const [token] = lex(heading);

		expect(heading).toBe('# \\~\\~Northwind\\~\\~');
		expect(token).toMatchObject({
			type: 'heading',
			tokens: [
				{ type: 'escape', text: '~' },
				{ type: 'escape', text: '~' },
				{ type: 'text', text: 'Northwind' },
				{ type: 'escape', text: '~' },
				{ type: 'escape', text: '~' }
			]
		});
		expect(token).not.toMatchObject({
			tokens: expect.arrayContaining([expect.objectContaining({ type: 'del' })])
		});
	});

	// Ohne Maskierung rendert marked "Research &copy; Labs" als "Research © Labs" und
	// "Project ###" als "Project", weil ### die schließende Zeichenfolge der Überschrift ist.
	it.each([
		{ brand: 'Research &copy; Labs', heading: '# Research \\&copy; Labs' },
		{ brand: 'Project ###', heading: '# Project \\#\\#\\#' },
		{ brand: 'A & B GmbH', heading: '# A \\& B GmbH' }
	])('keeps $brand literal in the heading', ({ brand, heading }) => {
		expect(replaceReadmeSource(source, { ...options, brand }).split('\n')[0]).toBe(heading);
	});

	it('keeps CRLF line endings in the rewritten clone block', () => {
		const crlf = source.replace(/\n/g, '\r\n');
		const updated = replaceReadmeSource(crlf, options);

		expect(updated).toContain(
			'git clone https://github.com/northwind/northwind-labs.git\r\ncd ./northwind-labs\r\n'
		);
		expect(updated).not.toContain('Live demo!');
		expect(updated).not.toMatch(/[^\r]\n/);
	});

	it('fails before writes when an anchor is missing or ambiguous', () => {
		expect(() => replaceReadmeSource('no heading here\n', options)).toThrow(
			/Could not find the top-level heading/
		);
		expect(() => replaceReadmeSource('# Title\n\nprose\n', options)).toThrow(
			/quick start clone block in README.md, found 0/
		);
		expect(() => replaceReadmeSource(source + source, options)).toThrow(
			/quick start clone block in README.md, found 2/
		);
	});
});

describe('template setup detects a consistent generated README', () => {
	const liveDemo =
		'> [Live demo!](https://demo.example) The public demo covers the user-facing features.\n\n';
	const bootstrap =
		'# Northwind Labs\n\n```bash\ngh repo create my-saas-product --template stickerdaniel/saas-starter --clone\ncd my-saas-product\nbun install\n```\n';
	const converted =
		'# Northwind Labs\n\n```bash\ngit clone https://github.com/northwind/northwind-labs.git\ncd ./northwind-labs\nbun install\n```\n';
	const previouslyConverted = converted.replace('cd ./northwind-labs', 'cd northwind-labs');

	it('treats the template bootstrap form as not set up', () => {
		expect(
			readmeShowsCompletedSetup(bootstrap, 'stickerdaniel/saas-starter', 'Northwind Labs')
		).toBe(false);
		expect(readmeShowsCompletedSetup(bootstrap, 'northwind/northwind-labs', 'Northwind Labs')).toBe(
			false
		);
	});

	it('accepts both converted directory forms only for the current repository and brand', () => {
		expect(readmeShowsCompletedSetup(converted, 'northwind/northwind-labs', 'Northwind Labs')).toBe(
			true
		);
		expect(
			readmeShowsCompletedSetup(previouslyConverted, 'northwind/northwind-labs', 'Northwind Labs')
		).toBe(true);
		expect(readmeShowsCompletedSetup(converted, 'someone/other-repo', 'Northwind Labs')).toBe(
			false
		);
		expect(readmeShowsCompletedSetup(converted, 'northwind/northwind-labs', 'Other Brand')).toBe(
			false
		);
	});

	it('requires the escaped generated heading and no template live demo paragraph', () => {
		const escapedHeading = converted.replace('# Northwind Labs', '# Research \\&copy; Labs');
		expect(
			readmeShowsCompletedSetup(escapedHeading, 'northwind/northwind-labs', 'Research &copy; Labs')
		).toBe(true);
		expect(
			readmeShowsCompletedSetup(
				converted.replace('# Northwind Labs', '# Other Brand'),
				'northwind/northwind-labs',
				'Northwind Labs'
			)
		).toBe(false);
		expect(
			readmeShowsCompletedSetup(
				converted.replace('\n\n```bash', `\n\n${liveDemo}\`\`\`bash`),
				'northwind/northwind-labs',
				'Northwind Labs'
			)
		).toBe(false);
	});

	it('reads the consistent state with CRLF line endings', () => {
		expect(
			readmeShowsCompletedSetup(
				converted.replace(/\n/g, '\r\n'),
				'northwind/northwind-labs',
				'Northwind Labs'
			)
		).toBe(true);
	});

	it('reports not set up when the clone block is missing or ambiguous', () => {
		expect(
			readmeShowsCompletedSetup(
				'# Northwind Labs\n\nprose\n',
				'northwind/northwind-labs',
				'Northwind Labs'
			)
		).toBe(false);
		expect(
			readmeShowsCompletedSetup(converted + converted, 'northwind/northwind-labs', 'Northwind Labs')
		).toBe(false);
	});
});

describe('template setup contact email', () => {
	it('enforces the 64-byte UTF-8 localpart boundary', () => {
		const astralLetter = '𐐀';
		expect(parseContactEmail(`${astralLetter.repeat(16)}@example.de`)?.user).toBe(
			astralLetter.repeat(16)
		);
		expect(parseContactEmail(`${astralLetter.repeat(17)}@example.de`)).toBeUndefined();
		expect(parseContactEmail(`${'é'.repeat(33)}@example.de`)).toBeUndefined();
	});

	it('enforces the combined 254-byte SMTP path boundary', () => {
		expect(parseContactEmail(`${'a'.repeat(64)}@${asciiDomainOfLength(189)}`)).toBeDefined();
		expect(parseContactEmail(`${'a'.repeat(64)}@${asciiDomainOfLength(190)}`)).toBeUndefined();
		expect(parseContactEmail(`a@${asciiDomainOfLength(252)}`)).toBeDefined();
		expect(parseContactEmail(`a@${asciiDomainOfLength(253)}`)).toBeUndefined();
	});

	it('measures Unicode localparts as UTF-8 and Unicode domains after IDNA conversion', () => {
		const unicodeLocal = 'é'.repeat(32);
		expect(parseContactEmail(`${unicodeLocal}@${asciiDomainOfLength(189)}`)).toBeDefined();
		expect(parseContactEmail(`${unicodeLocal}@${asciiDomainOfLength(190)}`)).toBeUndefined();

		const unicodeDomainAtLimit = `münchen.${asciiDomainOfLength(174)}`;
		const unicodeDomainOverLimit = `münchen.${asciiDomainOfLength(175)}`;
		expect(parseContactEmail(`${'a'.repeat(64)}@${unicodeDomainAtLimit}`)).toBeDefined();
		expect(parseContactEmail(`${'a'.repeat(64)}@${unicodeDomainOverLimit}`)).toBeUndefined();
	});

	it.each([
		{
			value: 'kontakt@northwind-labs.de',
			parts: { user: 'kontakt', domain: 'northwind-labs', tld: 'de' }
		},
		{ value: 'a@mail.example.com', parts: { user: 'a', domain: 'mail', tld: 'example.com' } },
		{
			value: 'first.last@example.co.uk',
			parts: { user: 'first.last', domain: 'example', tld: 'co.uk' }
		},
		{
			value: "jörg+o'connor@münchen.example",
			parts: { user: "jörg+o'connor", domain: 'münchen', tld: 'example' }
		}
	])('splits $value into three parts', ({ value, parts }) => {
		expect(parseContactEmail(value)).toEqual(parts);
	});

	// Zusätzliche @, Leerzeichen in den Segmenten und leere Domainlabels müssen durchfallen.
	it.each([
		'a@b@c.de',
		'erste person@example.de',
		'a@ex ample.de',
		'a@example .de',
		'a@.de',
		'a@example..de',
		'a@example.',
		'a@-example.de',
		'a@example-.de',
		`a@${'d'.repeat(64)}.de`,
		`a@${['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(63)].join('.')}`,
		'a?subject=changed@example.de',
		'a#fragment@example.de',
		'a/path@example.de',
		'a%20name@example.de',
		'a..b@example.de',
		'.a@example.de',
		'a.@example.de',
		'@example.de',
		'plain-text'
	])('rejects %s', (value) => {
		expect(parseContactEmail(value)).toBeUndefined();
	});
});

describe('template setup manifest metadata', () => {
	it('renames the worker without touching the trailing comment', () => {
		expect(replaceWranglerNameSource('name = "old" # keep me\nmain = "x"\n', 'new-name')).toBe(
			'name = "new-name" # keep me\nmain = "x"\n'
		);
	});

	it('renames only the root worker when environments have their own names', () => {
		const source =
			'name = "base-worker"\nmain = "x"\n\n[env.staging]\nname = "staging-worker" # keep me\n';
		expect(replaceWranglerNameSource(source, 'new-name')).toBe(
			'name = "new-name"\nmain = "x"\n\n[env.staging]\nname = "staging-worker" # keep me\n'
		);
	});

	it('ignores table and name syntax inside multiline TOML strings', () => {
		const source = `description = """
name = "basic-string"
[example.basic]
"""
literal = '''
name = "literal-string"
[example.literal]
'''
name = "base-worker"
main = "x"

[env.staging]
name = "staging-worker"
`;
		const updated = replaceWranglerNameSource(source, 'new-name');

		expect(updated).toBe(source.replace('name = "base-worker"', 'name = "new-name"'));
		expect(updated).toContain('name = "basic-string"\n[example.basic]');
		expect(updated).toContain('name = "literal-string"\n[example.literal]');
		expect(updated).toContain('[env.staging]\nname = "staging-worker"');
	});

	it.each([
		'name = """base-worker"""\n\n[env.staging]\nname = "staging-worker"\n',
		"name = '''base-worker'''\n\n[env.staging]\nname = \"staging-worker\"\n"
	])('fails closed when the root name uses a multiline string', (source) => {
		expect(() => replaceWranglerNameSource(source, 'new-name')).toThrow(/name assignment/);
	});

	it('fails before writes when the root worker name is missing or ambiguous', () => {
		expect(() =>
			replaceWranglerNameSource('[env.staging]\nname = "staging-worker"\n', 'new')
		).toThrow(/found 0/);
		expect(() => replaceWranglerNameSource('name = "a"\nname = "b"\n', 'new')).toThrow(/found 2/);
	});

	it('syncs only the lockfile root name', () => {
		const lock =
			'{\n  "lockfileVersion": 1,\n  "workspaces": {\n    "": {\n      "name": "saas-starter",\n      "dependencies": {\n        "zod": "4.4.2"\n      }\n    }\n  }\n}\n';
		const updated = replaceLockRootNameSource(lock, 'northwind-labs');

		expect(updated).toBe(lock.replace('"name": "saas-starter"', '"name": "northwind-labs"'));
		expect(updated).toContain('"zod": "4.4.2"');
	});

	it('fails before writes when the lockfile root name is missing', () => {
		expect(() => replaceLockRootNameSource('{"lockfileVersion": 1}', 'new')).toThrow(/found 0/);
	});
});

describe('template setup interactive answers', () => {
	const isPositive: (value: string) => string | undefined = (value) =>
		/^[a-z]+$/.test(value) ? undefined : 'must be lowercase letters';

	it('asks again until the answer validates', async () => {
		const answers = ['Nope!', '123', 'valid'];
		const problems: string[] = [];
		const result = await askUntilValid(
			async () => answers.shift(),
			'Value',
			'fallback',
			isPositive,
			(problem) => problems.push(problem)
		);

		expect(result).toBe('valid');
		expect(problems).toEqual(['must be lowercase letters', 'must be lowercase letters']);
	});

	it('gives up when the input ends', async () => {
		expect(
			await askUntilValid(
				async () => undefined,
				'Value',
				'fallback',
				isPositive,
				() => {}
			)
		).toBeUndefined();
	});
});
