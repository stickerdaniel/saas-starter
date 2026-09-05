import { describe, expect, it } from 'vitest';
import {
	askUntilValid,
	escapeMarkdownInline,
	githubSlugProperty,
	isValidGithubRepository,
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

describe('template setup repository configuration', () => {
	it.each(['owner/repo', 'owner-name/repo.name', 'Owner123/repo_name'])('accepts %s', (value) => {
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
		`${'a'.repeat(40)}/repo`,
		'/repo',
		'owner/.',
		'owner/..'
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

	it('fails instead of replacing the wrong one of two occurrences', () => {
		// Ein Beispiel im Doc-Kommentar steht vor dem echten Feld: der erste Treffer ist
		// nicht der, der die Laufzeit steuert.
		const source =
			"export interface SiteConfig {\n\t/** Example: githubSlug: 'octocat/hello-world' */\n\tgithubSlug: `${string}/${string}`;\n}\n\nexport const SITE_CONFIG = {\n\tgithubSlug: 'old-owner/old-repo'\n};\n";

		expect(() => replaceGithubSlugSource(source, 'new-owner/new-repo')).toThrow(
			/Expected exactly one githubSlug in src\/lib\/config\/site\.ts, found 2/
		);
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

	it('preserves legal dates when the legal identity is unchanged', () => {
		expect(updateLegalContentDatesSource(source, '2026-08-24', false)).toBe(source);
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

	it('rejects values it cannot represent instead of writing broken code', () => {
		expect(() => serializeConfigValue({ list: [1, 2] }, '')).toThrow(/Unsupported LEGAL_CONFIG/);
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
			'git clone https://github.com/northwind/northwind-labs.git\ncd northwind-labs\nbun install'
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
			'git clone https://github.com/northwind/northwind-cloud.git\ncd northwind-cloud'
		);
		expect(renamed).not.toContain('northwind-labs');
	});

	it('escapes a brand that would otherwise render as Markdown', () => {
		expect(escapeMarkdownInline('A *bold* [link]')).toBe('A \\*bold\\* \\[link\\]');
		expect(replaceReadmeSource(source, { ...options, brand: '*Star* Co' }).split('\n')[0]).toBe(
			'# \\*Star\\* Co'
		);
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

describe('template setup manifest metadata', () => {
	it('renames the worker without touching the trailing comment', () => {
		expect(replaceWranglerNameSource('name = "old" # keep me\nmain = "x"\n', 'new-name')).toBe(
			'name = "new-name" # keep me\nmain = "x"\n'
		);
	});

	it('fails before writes when the worker name is missing or ambiguous', () => {
		expect(() => replaceWranglerNameSource('main = "x"\n', 'new')).toThrow(/found 0/);
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
