import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
	MAX_DECOMPRESSED_BYTES,
	validateTemplateArchive,
	type ArchiveValidationMetrics
} from '../src/archive.js';
import { MAX_ARCHIVE_BYTES } from '../src/template.js';
import {
	changedEntries,
	tarGz,
	validTemplateEntries,
	workspaceManifest,
	workspaceTemplateEntries,
	type TarFixtureEntry
} from './archive-fixture.js';

const REVISION = 'a'.repeat(40);

async function validates(extra: TarFixtureEntry[] = []) {
	return await validateTemplateArchive(tarGz([...validTemplateEntries(), ...extra]), REVISION);
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
				tarGz(replacing('root/scripts/executable.ts', { path: entryPath, data: 'bad' })),
				REVISION
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
		await expect(validateTemplateArchive(compressed, REVISION)).rejects.toThrow(
			/backslash path metadata/
		);
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
			await expect(validateTemplateArchive(tarGz(entries), REVISION)).rejects.toThrow(/backslash/);
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
		await expect(validateTemplateArchive(compressed, REVISION)).rejects.toThrow(
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
		await expect(validateTemplateArchive(compressed, REVISION)).rejects.toThrow(
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
				),
				REVISION
			)
		).rejects.toThrow(/unknown symbolic link/);
		await expect(
			validateTemplateArchive(
				tarGz(validTemplateEntries().filter((entry) => entry.path !== 'root/AGENTS.md')),
				REVISION
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
		'src/lib/content/legal-content-dates.ts',
		'src/lib/content/legal-metadata.ts'
	])('rejects an archive missing setup input %s', async (requiredFile) => {
		const entries = validTemplateEntries().filter((entry) => entry.path !== `root/${requiredFile}`);
		await expect(validateTemplateArchive(tarGz(entries), REVISION)).rejects.toThrow(
			`public setup requires regular file ${requiredFile}`
		);
	});

	it('requires the canonical setup input path casing', async () => {
		const entries = replacing('root/README.md', {
			path: 'root/readme.md',
			data: '# Wrong case\n'
		});
		await expect(validateTemplateArchive(tarGz(entries), REVISION)).rejects.toThrow(
			'public setup requires regular file README.md'
		);
	});

	it('rejects a setup input that is not a regular file', async () => {
		const entries = replacing('root/wrangler.toml', {
			path: 'root/wrangler.toml',
			type: 'Directory'
		});
		await expect(validateTemplateArchive(tarGz(entries), REVISION)).rejects.toThrow(
			'public setup requires regular file wrangler.toml'
		);
	});

	it('rejects multiple roots, private files, marker collisions, and invalid setup manifests', async () => {
		await expect(validates([{ path: 'other/file', data: 'x' }])).rejects.toThrow(/multiple roots/);
		await expect(validates([{ path: 'root/.env.local', data: 'x' }])).rejects.toThrow(/forbidden/);
		await expect(
			validates([{ path: 'root/.saas-starter-scaffold.json', data: 'x' }])
		).rejects.toThrow(/forbidden/);
	});

	it.each([1, 4, '2'])(
		'rejects templateSetupVersion %j from another setup protocol',
		async (version) => {
			await expect(
				validateTemplateArchive(
					tarGz(
						replacing('root/package.json', {
							path: 'root/package.json',
							data: JSON.stringify({
								templateSetupVersion: version,
								scripts: { setup: 'bun scripts/template-setup.ts' }
							})
						})
					),
					REVISION
				)
			).rejects.toThrow(
				`Template revision ${REVISION} declares templateSetupVersion ${JSON.stringify(version)}, and create-saas-starter`
			);
		}
	);

	it('bounds tree and alias indexing work at the materialized entry limit', async () => {
		const base = validTemplateEntries();
		const fillers = Array.from({ length: 19_999 - base.length }, (_, index) => ({
			path: `root/entries/${index.toString().padStart(5, '0')}`,
			data: ''
		}));
		const metrics = validationMetrics();

		const archive = await validateTemplateArchive(tarGz([...fillers, ...base]), REVISION, metrics);

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
			validateTemplateArchive(tarGz([...base, ...fillers, ...aliases]), REVISION, metrics)
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
				REVISION,
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
		await expect(
			validateTemplateArchive(Buffer.alloc(MAX_ARCHIVE_BYTES + 1), REVISION)
		).rejects.toThrow(/compressed archive/);
		const oversizedRaw = Buffer.alloc(MAX_DECOMPRESSED_BYTES + 1);
		await expect(validateTemplateArchive(gzipSync(oversizedRaw), REVISION)).rejects.toThrow(
			/decompress/
		);
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

function workspaceArchive(changes: Record<string, string | undefined> = {}): Buffer {
	return tarGz(changedEntries(workspaceTemplateEntries(), changes));
}

const STARTER_MEMBERS = [
	'apps/web',
	'packages/backend',
	'packages/create-saas-starter',
	'packages/emails',
	'packages/eslint-plugin',
	'packages/product-config',
	'packages/tooling',
	'packages/ui'
];

describe('the version 3 archive contract', () => {
	it('validates the fixture of the version 3 contract and admits its workspaces', async () => {
		const archive = await validateTemplateArchive(workspaceArchive(), REVISION);

		expect(archive.tree).toEqual({ version: 3, workspaces: STARTER_MEMBERS });
		expect(archive.profiles).toEqual([]);
		expect(archive.files.map(({ path }) => path)).toEqual(
			expect.arrayContaining([
				'apps/web/wrangler.toml',
				'packages/product-config/src/config/site.ts',
				'packages/backend/convex/_generated/api.d.ts'
			])
		);
	});

	it('refuses the moved tree under the version 2 contract', async () => {
		await expect(
			validateTemplateArchive(
				workspaceArchive({ 'package.json': workspaceManifest({ templateSetupVersion: 2 }) }),
				REVISION
			)
		).rejects.toThrow(
			`public setup requires regular file wrangler.toml for templateSetupVersion 2 of template revision ${REVISION}`
		);
	});

	it('refuses an archive without the generated Convex bindings and names version and path', async () => {
		await expect(
			validateTemplateArchive(
				workspaceArchive({ 'packages/backend/convex/_generated/api.d.ts': undefined }),
				REVISION
			)
		).rejects.toThrow(
			`public setup requires regular file packages/backend/convex/_generated/api.d.ts for templateSetupVersion 3 of template revision ${REVISION}`
		);
	});

	it('refuses an archive without the UI workspace manifest through the dependency on it', async () => {
		await expect(
			validateTemplateArchive(workspaceArchive({ 'packages/ui/package.json': undefined }), REVISION)
		).rejects.toThrow(
			`Template revision ${REVISION} with templateSetupVersion 3 declares @repo/ui as workspace:* in apps/web/package.json, and no workspace has that name.`
		);
	});

	it('refuses an archive whose web workspace manifest another app below apps/ replaces', async () => {
		await expect(
			validateTemplateArchive(
				workspaceArchive({
					'apps/web/package.json': undefined,
					'apps/customer-portal/package.json': JSON.stringify({ name: 'customer-portal' })
				}),
				REVISION
			)
		).rejects.toThrow(
			`Template revision ${REVISION} with templateSetupVersion 3 has no workspace apps/web with a regular file apps/web/package.json.`
		);
	});

	it('admits a product app below apps/ beside the web workspace', async () => {
		const archive = await validateTemplateArchive(
			workspaceArchive({
				'apps/customer-portal/package.json': JSON.stringify({ name: 'customer-portal' })
			}),
			REVISION
		);

		expect(archive.tree).toEqual({
			version: 3,
			workspaces: ['apps/customer-portal', ...STARTER_MEMBERS]
		});
	});

	it.each([
		{
			label: 'the string "3"',
			fields: { templateSetupVersion: '3' },
			expected: 'templateSetupVersion "3"'
		},
		{
			label: 'a setup script one character off',
			fields: { scripts: { setup: 'bun scripts/template-setup.js' } },
			expected: 'the setup script "bun scripts/template-setup.js"'
		}
	])('refuses a manifest with $label and names the revision', async ({ fields, expected }) => {
		await expect(
			validateTemplateArchive(
				workspaceArchive({ 'package.json': workspaceManifest(fields) }),
				REVISION
			)
		).rejects.toThrow(`Template revision ${REVISION} declares ${expected}`);
	});

	it.each([
		{ label: 'the profile list the manifest declares', fields: { templateProfiles: ['tests'] } },
		{ label: 'an empty profile list without templateProfiles', fields: {} }
	])('reads $label', async ({ fields }) => {
		const archive = await validateTemplateArchive(
			workspaceArchive({ 'package.json': workspaceManifest(fields) }),
			REVISION
		);

		expect(archive.profiles).toEqual(fields.templateProfiles ?? []);
	});

	it.each([
		{
			label: 'a pattern without a member',
			changes: {
				'package.json': workspaceManifest({ workspaces: ['apps/*', 'packages/*', 'tools/*'] }),
				'tools/README.md': '# Tools\n'
			},
			expected:
				'declares the workspace pattern tools/*, and no directory directly below tools/ holds a package.json.'
		},
		{
			label: 'two members of one name',
			changes: { 'packages/emails/package.json': JSON.stringify({ name: '@repo/ui' }) },
			expected:
				'names two workspaces "@repo/ui": packages/emails/package.json and packages/ui/package.json.'
		},
		{
			label: 'a workspace dependency on a name no member has',
			changes: {
				'apps/web/package.json': JSON.stringify({
					name: '@repo/web',
					devDependencies: { '@repo/voice': 'workspace:^' }
				})
			},
			expected:
				'declares @repo/voice as workspace:^ in apps/web/package.json, and no workspace has that name.'
		},
		{
			label: 'a recursive pattern',
			changes: { 'package.json': workspaceManifest({ workspaces: ['apps/*', 'packages/**'] }) },
			expected:
				'declares the workspace pattern "packages/**", which is neither a directory nor <dir>/*.'
		}
	])('refuses $label', async ({ changes, expected }) => {
		await expect(validateTemplateArchive(workspaceArchive(changes), REVISION)).rejects.toThrow(
			`Template revision ${REVISION} with templateSetupVersion 3 ${expected}`
		);
	});

	it('accepts a directory below a pattern that holds no package.json, which is no member', async () => {
		const archive = await validateTemplateArchive(
			workspaceArchive({ 'packages/assets/logo.svg': '<svg/>' }),
			REVISION
		);

		expect(archive.tree).toEqual({ version: 3, workspaces: STARTER_MEMBERS });
		expect(archive.files.map(({ path }) => path)).toContain('packages/assets/logo.svg');
	});
});

/**
 * The six membership fixtures of `probe-c/workspaces.ts`: five candidate directories, each with a
 * `package.json` named `local-<index>`, and one pattern list per fixture. Bun 1.3.9, 1.3.14 and
 * 1.4.5 gave the member sets in `probe-c/workspaces.log`. The overlap fixture here also names
 * `apps/web`, which version 3 requires, and Bun 1.4.3 installs `apps/web` and `packages/ui` for it.
 */
describe('workspace membership', () => {
	const candidates = [
		'apps/web',
		'packages/ui',
		'packages/.dot',
		'packages/deep/leaf',
		'libs/misc'
	];
	function membershipArchive(patterns: string[], duplicate = false): Buffer {
		const changes: Record<string, string | undefined> = Object.fromEntries(
			STARTER_MEMBERS.map((member) => [`${member}/package.json`, undefined])
		);
		for (const [index, candidate] of candidates.entries()) {
			const name = duplicate && candidate === 'libs/misc' ? 'local-0' : `local-${index}`;
			changes[`${candidate}/package.json`] = JSON.stringify({ name, version: '1.0.0' });
		}
		changes['package.json'] = workspaceManifest({ workspaces: patterns });
		return workspaceArchive(changes);
	}

	it.each([
		{ fixture: 'v3', patterns: ['apps/*', 'packages/*'], members: ['apps/web', 'packages/ui'] },
		{ fixture: 'literal', patterns: ['apps/web'], members: ['apps/web'] },
		{
			fixture: 'overlap',
			patterns: ['apps/web', 'packages/*', 'packages/ui'],
			members: ['apps/web', 'packages/ui']
		}
	])('admits the members Bun installs for the $fixture fixture', async ({ patterns, members }) => {
		const archive = await validateTemplateArchive(membershipArchive(patterns), REVISION);

		expect(archive.tree).toEqual({ version: 3, workspaces: members });
	});

	it.each([
		{
			fixture: 'missing',
			patterns: ['empty/*'],
			duplicate: false,
			expected:
				'declares the workspace pattern empty/*, and no directory directly below empty/ holds a package.json.'
		},
		{
			fixture: 'duplicate',
			patterns: ['apps/*', 'libs/*'],
			duplicate: true,
			expected: 'names two workspaces "local-0": apps/web/package.json and libs/misc/package.json.'
		},
		{
			fixture: 'deep',
			patterns: ['packages/**'],
			duplicate: false,
			expected:
				'declares the workspace pattern "packages/**", which is neither a directory nor <dir>/*.'
		}
	])('refuses the $fixture fixture', async ({ patterns, duplicate, expected }) => {
		await expect(
			validateTemplateArchive(membershipArchive(patterns, duplicate), REVISION)
		).rejects.toThrow(`Template revision ${REVISION} with templateSetupVersion 3 ${expected}`);
	});
});
