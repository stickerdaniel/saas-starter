import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
	MAX_DECOMPRESSED_BYTES,
	validateTemplateArchive,
	type ArchiveValidationMetrics
} from '../src/archive.js';
import { MAX_ARCHIVE_BYTES } from '../src/template.js';
import { tarGz, validTemplateEntries, type TarFixtureEntry } from './archive-fixture.js';

async function validates(extra: TarFixtureEntry[] = []) {
	return await validateTemplateArchive(tarGz([...validTemplateEntries(), ...extra]));
}

function replacing(path: string, replacement: TarFixtureEntry): TarFixtureEntry[] {
	return validTemplateEntries().map((entry) => (entry.path === path ? replacement : entry));
}

function replacingWith(path: string, replacements: TarFixtureEntry[]): TarFixtureEntry[] {
	return validTemplateEntries().flatMap((entry) => (entry.path === path ? replacements : [entry]));
}

function paxRecord(key: string, value: string): string {
	let length = Buffer.byteLength(`0 ${key}=${value}\n`);
	while (true) {
		const record = `${length} ${key}=${value}\n`;
		const actualLength = Buffer.byteLength(record);
		if (actualLength === length) return record;
		length = actualLength;
	}
}

function validationMetrics(): ArchiveValidationMetrics {
	return {
		treeParentLookups: 0,
		aliasIndexComparisons: 0,
		aliasDescendantVisits: 0,
		aliasEntriesMaterialized: 0,
		aliasBytesMaterialized: 0
	};
}

describe('validateTemplateArchive', () => {
	it('materializes measured aliases and preserves executable bits', async () => {
		const archive = await validates();
		const claude = archive.files.find((entry) => entry.path === 'CLAUDE.md');
		const skill = archive.files.find((entry) => entry.path === '.claude/skills/example/SKILL.md');
		const executable = archive.files.find((entry) => entry.path === 'scripts/executable.ts');

		expect(claude?.data?.toString()).toBe('# Guidance\n');
		expect(skill?.data?.toString()).toBe('# Skill\n');
		expect(executable?.mode).toBe(0o755);
		expect(archive.sha256).toMatch(/^[0-9a-f]{64}$/);
	});

	it('uses real PAX and GNU long-name metadata', async () => {
		const paxPath = `root/${Array.from({ length: 20 }, (_, index) => `segment-${index}`).join('/')}/pax.txt`;
		const gnuPath = `root/${Array.from({ length: 20 }, (_, index) => `gnu-${index}`).join('/')}/gnu.txt`;
		const archive = await validates([
			{ path: 'root/pax-placeholder', paxPath, data: 'pax' },
			{ path: '././@LongLink', type: 'NextFileHasLongPath', data: `${gnuPath}\0` },
			{ path: 'root/gnu-placeholder', data: 'gnu' }
		]);

		expect(archive.files.some((entry) => entry.path === paxPath.slice(5))).toBe(true);
		expect(archive.files.some((entry) => entry.path === gnuPath.slice(5))).toBe(true);
	});

	it.each([
		['traversal', '../escape'],
		['absolute path', '/escape'],
		['drive path', 'C:/escape'],
		['reserved character', 'root/a:b'],
		['device name', 'root/CON.txt'],
		['superscript COM device name', 'root/COM¹.txt'],
		['superscript LPT device name', 'root/LPT².log'],
		['trailing dot', 'root/file.'],
		['control character', 'root/bad\u0001name']
	])('rejects %s entries', async (_name, entryPath) => {
		await expect(
			validateTemplateArchive(
				tarGz(replacing('root/scripts/executable.ts', { path: entryPath, data: 'bad' }))
			)
		).rejects.toThrow('Unsafe template archive');
	});

	it('rejects raw backslashes in ustar path bytes on every platform', async () => {
		const rawPath = String.raw`root\escape`;
		const compressed = tarGz(
			replacing('root/scripts/executable.ts', {
				path: 'root/escape',
				rawPath,
				data: 'bad'
			})
		);

		expect(gunzipSync(compressed).includes(Buffer.from(rawPath))).toBe(true);
		await expect(validateTemplateArchive(compressed)).rejects.toThrow(/backslash path metadata/);
	});

	it.each([
		[
			'ustar link',
			replacing('root/CLAUDE.md', {
				path: 'root/CLAUDE.md',
				type: 'SymbolicLink',
				linkpath: 'AGENTS.md',
				rawLinkpath: String.raw`AGENTS\md`
			})
		],
		[
			'PAX path',
			replacing('root/scripts/executable.ts', {
				path: 'root/pax-placeholder',
				paxPath: String.raw`root\pax`,
				data: 'bad'
			})
		],
		[
			'PAX path after malformed metadata',
			replacingWith('root/scripts/executable.ts', [
				{
					path: 'PaxHeader/path',
					type: 'ExtendedHeader',
					data: `malformed\n${paxRecord('path', String.raw`root\pax`)}`
				},
				{ path: 'root/pax-placeholder', data: 'bad' }
			])
		],
		[
			'ustar path after a PAX size override',
			replacingWith('root/scripts/executable.ts', [
				{
					path: 'PaxHeader/size',
					type: 'ExtendedHeader',
					data: paxRecord('size', '1024')
				},
				{ path: 'root/padded.bin', data: Buffer.alloc(1024), rawSize: 0 },
				{
					path: 'root/escape',
					rawPath: String.raw`root\escape`,
					data: 'bad'
				}
			])
		],
		[
			'PAX link',
			replacing('root/CLAUDE.md', {
				path: 'root/CLAUDE.md',
				type: 'SymbolicLink',
				linkpath: 'AGENTS.md',
				paxLinkpath: String.raw`AGENTS\md`
			})
		],
		[
			'GNU path',
			replacingWith('root/scripts/executable.ts', [
				{
					path: '././@LongLink',
					type: 'NextFileHasLongPath',
					data: `${String.raw`root\gnu`}\0`
				},
				{ path: 'root/gnu-placeholder', data: 'bad' }
			])
		],
		[
			'GNU link',
			replacingWith('root/CLAUDE.md', [
				{
					path: '././@LongLink',
					type: 'NextFileHasLongLinkpath',
					data: `${String.raw`AGENTS\md`}\0`
				},
				{ path: 'root/CLAUDE.md', type: 'SymbolicLink', linkpath: 'AGENTS.md' }
			])
		]
	] satisfies Array<[string, TarFixtureEntry[]]>)(
		'rejects backslashes in %s metadata',
		async (_name, entries) => {
			await expect(validateTemplateArchive(tarGz(entries))).rejects.toThrow(/backslash/);
		}
	);

	it('allows backslashes in regular file contents', async () => {
		const contents = String.raw`C:\Users\example\project`;
		const archive = await validates([{ path: 'root/windows.txt', data: contents }]);

		expect(archive.files.find((entry) => entry.path === 'windows.txt')?.data?.toString()).toBe(
			contents
		);
	});

	it('rejects a signed base-256 negative size before offset arithmetic', async () => {
		const compressed = tarGz(
			replacing('root/scripts/executable.ts', {
				path: 'root/negative.bin',
				data: '',
				rawBase256Size: -512
			})
		);
		const raw = gunzipSync(compressed);
		const headerOffset = raw.indexOf(Buffer.from('root/negative.bin'));

		expect(headerOffset % 512).toBe(0);
		expect(raw[headerOffset + 124]).toBe(0xff);
		await expect(validateTemplateArchive(compressed)).rejects.toThrow(
			'negative archive entry size'
		);
	});

	it('rejects a negative PAX size before applying it to an entry', async () => {
		const compressed = tarGz(
			replacingWith('root/scripts/executable.ts', [
				{
					path: 'PaxHeader/size',
					type: 'ExtendedHeader',
					data: paxRecord('size', '-512')
				},
				{ path: 'root/negative.bin', data: '' }
			])
		);

		expect(gunzipSync(compressed).includes(Buffer.from('size=-512\n'))).toBe(true);
		await expect(validateTemplateArchive(compressed)).rejects.toThrow(
			'negative archive entry size'
		);
	});

	it('rejects case and Unicode normalization collisions', async () => {
		await expect(validates([{ path: 'root/agents.md', data: 'collision' }])).rejects.toThrow(
			/collision/
		);
		await expect(
			validates([
				{ path: 'root/caf\u00e9.txt', data: 'one' },
				{ path: 'root/cafe\u0301.txt', data: 'two' }
			])
		).rejects.toThrow(/collision/);
	});

	it('rejects duplicate entries and file-parent conflicts in either archive order', async () => {
		await expect(validates([{ path: 'root/AGENTS.md', data: 'duplicate' }])).rejects.toThrow(
			/duplicate/
		);
		for (const conflict of [
			[
				{ path: 'root/conflict', data: 'file' },
				{ path: 'root/conflict/child', data: 'child' }
			],
			[
				{ path: 'root/reversed/child', data: 'child' },
				{ path: 'root/reversed', data: 'file' }
			]
		]) {
			await expect(validates(conflict)).rejects.toThrow(/conflict/);
		}
	});

	it.each(['Link', 'CharacterDevice', 'BlockDevice', 'FIFO'] as const)(
		'rejects %s entries',
		async (type) => {
			await expect(
				validates([{ path: `root/bad-${type}`, type, linkpath: type === 'Link' ? 'x' : undefined }])
			).rejects.toThrow(/unsupported tar entry type/);
		}
	);

	it('rejects unknown and dangling aliases', async () => {
		await expect(
			validateTemplateArchive(
				tarGz(
					replacing('root/CLAUDE.md', {
						path: 'root/CLAUDE.md',
						type: 'SymbolicLink',
						linkpath: 'missing.md'
					})
				)
			)
		).rejects.toThrow(/unknown symbolic link/);
		await expect(
			validateTemplateArchive(
				tarGz(validTemplateEntries().filter((entry) => entry.path !== 'root/AGENTS.md'))
			)
		).rejects.toThrow(/target is missing/);
	});

	it.each([
		'package.json',
		'bun.lock',
		'scripts/template-setup.ts',
		'wrangler.toml',
		'README.md',
		'src/lib/config/site.ts',
		'src/lib/config/legal.ts',
		'src/lib/content/legal-metadata.ts'
	])('rejects an archive missing setup input %s', async (requiredFile) => {
		const entries = validTemplateEntries().filter((entry) => entry.path !== `root/${requiredFile}`);
		await expect(validateTemplateArchive(tarGz(entries))).rejects.toThrow(
			`public setup requires regular file ${requiredFile}`
		);
	});

	it('requires the canonical setup input path casing', async () => {
		const entries = replacing('root/README.md', {
			path: 'root/readme.md',
			data: '# Wrong case\n'
		});
		await expect(validateTemplateArchive(tarGz(entries))).rejects.toThrow(
			'public setup requires regular file README.md'
		);
	});

	it('rejects a setup input that is not a regular file', async () => {
		const entries = replacing('root/wrangler.toml', {
			path: 'root/wrangler.toml',
			type: 'Directory'
		});
		await expect(validateTemplateArchive(tarGz(entries))).rejects.toThrow(
			'public setup requires regular file wrangler.toml'
		);
	});

	it('rejects multiple roots, private files, marker collisions, and invalid setup manifests', async () => {
		await expect(validates([{ path: 'other/file', data: 'x' }])).rejects.toThrow(/multiple roots/);
		await expect(validates([{ path: 'root/.env.local', data: 'x' }])).rejects.toThrow(/forbidden/);
		await expect(
			validates([{ path: 'root/.saas-starter-scaffold.json', data: 'x' }])
		).rejects.toThrow(/forbidden/);
		await expect(
			validateTemplateArchive(
				tarGz(
					replacing('root/package.json', {
						path: 'root/package.json',
						data: '{"templateSetupVersion":2,"scripts":{"setup":"bun scripts/template-setup.ts"}}'
					})
				)
			)
		).rejects.toThrow(/templateSetupVersion/);
	});

	it('bounds tree and alias indexing work at the materialized entry limit', async () => {
		const base = validTemplateEntries();
		const fillers = Array.from({ length: 19_999 - base.length }, (_, index) => ({
			path: `root/entries/${index.toString().padStart(5, '0')}`,
			data: ''
		}));
		const metrics = validationMetrics();

		const archive = await validateTemplateArchive(tarGz([...fillers, ...base]), metrics);

		expect(archive.files).toHaveLength(20_000);
		expect(metrics.treeParentLookups).toBeLessThan(100_000);
		expect(metrics.aliasIndexComparisons).toBeLessThanOrEqual(32);
		expect(metrics.aliasDescendantVisits).toBe(1);
	});

	it('stops alias entry materialization as soon as the limit is reached', async () => {
		const base = validTemplateEntries().filter(
			(entry) =>
				!entry.path.startsWith('root/.agents/skills/example') &&
				entry.path !== 'root/.claude/skills/example'
		);
		const aliases = Array.from({ length: 20 }, (_, index) => [
			{ path: `root/.agents/skills/alias-${index}`, type: 'Directory' as const },
			{ path: `root/.agents/skills/alias-${index}/SKILL.md`, data: 'x' },
			{
				path: `root/.claude/skills/alias-${index}`,
				type: 'SymbolicLink' as const,
				linkpath: `../../.agents/skills/alias-${index}`
			}
		]).flat();
		const fillers = Array.from({ length: 20_000 - base.length - aliases.length }, (_, index) => ({
			path: `root/entries/${index.toString().padStart(5, '0')}`,
			data: ''
		}));
		const metrics = validationMetrics();

		await expect(
			validateTemplateArchive(tarGz([...base, ...fillers, ...aliases]), metrics)
		).rejects.toThrow(/alias materialization exceeds the entry limit/);
		expect(metrics.aliasEntriesMaterialized).toBe(21);
		expect(metrics.aliasEntriesMaterialized).toBeLessThan(41);
	});

	it('checks alias bytes before copying the entry that exceeds the limit', async () => {
		const metrics = validationMetrics();

		await expect(
			validateTemplateArchive(
				tarGz([
					...validTemplateEntries(),
					{
						path: 'root/.agents/skills/example/large.bin',
						data: Buffer.alloc(33 * 1024 * 1024)
					}
				]),
				metrics
			)
		).rejects.toThrow(/alias materialization exceeds the size limit/);
		expect(metrics.aliasEntriesMaterialized).toBe(2);
		expect(metrics.aliasBytesMaterialized).toBe(11);
	});

	it('rejects archives above the parsed entry limit', async () => {
		const entries = Array.from({ length: 20_000 }, (_, index) => ({
			path: `root/entries/${index}`,
			data: ''
		}));
		await expect(validates(entries)).rejects.toThrow(/more than 20000 entries/);
	});

	it('enforces compressed, decompressed, depth, and metadata limits', async () => {
		await expect(validateTemplateArchive(Buffer.alloc(MAX_ARCHIVE_BYTES + 1))).rejects.toThrow(
			/compressed archive/
		);
		const oversizedRaw = Buffer.alloc(MAX_DECOMPRESSED_BYTES + 1);
		await expect(validateTemplateArchive(gzipSync(oversizedRaw))).rejects.toThrow(/decompress/);
		await expect(
			validates([
				{
					path: `root/${Array.from({ length: 65 }, () => 'a').join('/')}`,
					data: 'deep'
				}
			])
		).rejects.toThrow(/path depth/);
		await expect(
			validates([
				{
					path: 'root/meta-placeholder',
					paxPath: `root/${'a'.repeat(1024 * 1024)}`,
					data: 'metadata'
				}
			])
		).rejects.toThrow();
	});
});
