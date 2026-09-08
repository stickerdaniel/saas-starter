import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MAX_DECOMPRESSED_BYTES, validateTemplateArchive } from '../src/archive.js';
import { MAX_ARCHIVE_BYTES } from '../src/template.js';
import { tarGz, validTemplateEntries, type TarFixtureEntry } from './archive-fixture.js';

async function validates(extra: TarFixtureEntry[] = []) {
	return await validateTemplateArchive(tarGz([...validTemplateEntries(), ...extra]));
}

function replacing(path: string, replacement: TarFixtureEntry): TarFixtureEntry[] {
	return validTemplateEntries().map((entry) => (entry.path === path ? replacement : entry));
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
		['backslash', String.raw`root\escape`],
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

	it('rejects duplicate entries and file-parent conflicts', async () => {
		await expect(validates([{ path: 'root/AGENTS.md', data: 'duplicate' }])).rejects.toThrow(
			/duplicate/
		);
		await expect(
			validates([
				{ path: 'root/conflict', data: 'file' },
				{ path: 'root/conflict/child', data: 'child' }
			])
		).rejects.toThrow(/conflict/);
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

	it('enforces entry and alias-materialization limits', async () => {
		const entries = Array.from({ length: 20_000 }, (_, index) => ({
			path: `root/entries/${index}`,
			data: ''
		}));
		await expect(validates(entries)).rejects.toThrow(/more than 20000 entries/);
		await expect(
			validates([
				{ path: 'root/.agents/skills/example/large.bin', data: Buffer.alloc(33 * 1024 * 1024) }
			])
		).rejects.toThrow(/alias materialization exceeds the size limit/);
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
