import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLAT_TREE, inPathSets, type Tree } from '../../../../scripts/path-sets';
import { removeMaintainerCliScripts, SETUP_LAYOUTS } from '../../../../scripts/template-setup';
import { ALLOWED_EDGES, BASE_TABLE, WORKSPACES, type StarterWorkspace } from '../layout/v3';
import { UPSTREAM_CONTEXT, UPSTREAM_REPOSITORY } from './apply-layout';

const CHECKOUT = join(import.meta.dirname, '../../../..');
const REVISION = 'a'.repeat(40);

const upstream =
	process.env[UPSTREAM_CONTEXT] === '1' || process.env.GITHUB_REPOSITORY === UPSTREAM_REPOSITORY;

const creator = upstream
	? {
			archive: await import('../../../../packages/create-saas-starter/src/archive'),
			fixture: await import('../../../../packages/create-saas-starter/test/archive-fixture')
		}
	: undefined;

const VERSION_3_INPUTS = [
	'src/app.html',
	'static/manifest.webmanifest',
	'convex.json',
	'src/lib/convex/_generated/api.d.ts'
];

const starterWorkspaces = Object.keys(WORKSPACES) as StarterWorkspace[];

const TITLE = 'the consumers of the version 3 table in the starter';

function consumers({ archive, fixture }: NonNullable<typeof creator>) {
	function tableArchive(omit?: string) {
		const flat = [
			...fixture.validTemplateEntries(),
			...VERSION_3_INPUTS.map((path) => ({ path: `root/${path}`, data: `fixture ${path}\n` }))
		];
		const moved = flat.flatMap((entry) => {
			const path = entry.path.slice('root/'.length);
			const to = BASE_TABLE.place(path)?.to;
			if (to === null) return [];
			if (path === 'package.json') return [{ ...entry, data: fixture.workspaceManifest({}) }];
			return [{ ...entry, path: `root/${to ?? path}` }];
		});
		const manifests = starterWorkspaces.flatMap((workspace) => {
			const { root, name } = WORKSPACES[workspace];
			if (name === null || root === omit) return [];
			const dependencies = Object.fromEntries(
				ALLOWED_EDGES[workspace].map((target) => [WORKSPACES[target].name, 'workspace:*'])
			);
			return [{ path: `root/${root}package.json`, data: JSON.stringify({ name, dependencies }) }];
		});
		return [...moved, ...manifests];
	}

	it('names each version 3 file where the table places its flat file', () => {
		const flat = [...archive.ARCHIVE_CONTRACTS[2].requiredFiles, ...VERSION_3_INPUTS];

		expect(flat.map((path) => BASE_TABLE.place(path)?.to)).toEqual([
			...archive.ARCHIVE_CONTRACTS[3].requiredFiles
		]);
	});

	it('validates the archive the table makes of the flat fixture, and version 2 refuses it', async () => {
		const validated = await archive.validateTemplateArchive(
			fixture.tarGz(tableArchive()),
			REVISION
		);

		expect(validated.tree).toEqual({
			version: 3,
			workspaces: starterWorkspaces
				.flatMap((workspace) => (WORKSPACES[workspace].name ? [WORKSPACES[workspace].root] : []))
				.map((root) => root.slice(0, -1))
				.sort()
		});
		await expect(
			archive.validateTemplateArchive(
				fixture.tarGz(
					fixture.changedEntries(tableArchive(), {
						'package.json': fixture.workspaceManifest({ templateSetupVersion: 2 })
					})
				),
				REVISION
			)
		).rejects.toThrow('for templateSetupVersion 2');
	});

	it('refuses the table archive without the UI workspace manifest', async () => {
		await expect(
			archive.validateTemplateArchive(fixture.tarGz(tableArchive('packages/ui/')), REVISION)
		).rejects.toThrow('declares @repo/ui as workspace:* in apps/web/package.json');
	});

	it.each([
		'apps/*',
		'packages/*',
		'packages/create-saas-starter',
		'packages/create-saas-starter/*',
		'packages/create-saas-starter/sub'
	])('gives creator and setup one verdict on %s reaching the creator', async (pattern) => {
		const manifest = fixture.workspaceManifest({
			scripts: {
				setup: 'bun scripts/template-setup.ts',
				postinstall: 'bun run build',
				test: 'bun run test:unit'
			},
			workspaces: ['apps/*', 'packages/*', pattern]
		});
		const entries = fixture.changedEntries(fixture.workspaceTemplateEntries(), {
			'package.json': manifest,
			'packages/create-saas-starter/sub/package.json': JSON.stringify({ name: 'creator-sub' })
		});
		const creatorVerdict = await archive
			.validateTemplateArchive(fixture.tarGz(entries), REVISION)
			.then(
				() => 'admitted',
				() => 'refused'
			);
		let setupVerdict = 'admitted';
		try {
			removeMaintainerCliScripts(JSON.parse(manifest), SETUP_LAYOUTS[3]);
		} catch {
			setupVerdict = 'refused';
		}

		expect(creatorVerdict).toBe(setupVerdict);
	});

	it('gives the creator fixture the members, names and dependencies of the table', () => {
		expect(fixture.WORKSPACE_MEMBERS).toEqual(
			Object.fromEntries(
				starterWorkspaces.flatMap((workspace) => {
					const { root, name } = WORKSPACES[workspace];
					if (name === null) return [];
					const dependencies = ALLOWED_EDGES[workspace].map((target) => WORKSPACES[target].name);
					return [[root.slice(0, -1), { name, dependencies }]];
				})
			)
		);
	});

	it('classifies every tracked file in the tests set the same before and after the table places it', () => {
		const workspaceTree: Tree = {
			layout: 'workspace',
			workspaces: Object.values(WORKSPACES).map(({ root }) => root)
		};
		const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: CHECKOUT, encoding: 'utf8' })
			.split('\0')
			.filter(Boolean);
		const differences = tracked.flatMap((path) => {
			const to = BASE_TABLE.place(path)?.to;
			if (!to) return [];
			const before = inPathSets(FLAT_TREE, path, ['tests']);
			return before === inPathSets(workspaceTree, to, ['tests'])
				? []
				: [`${path} -> ${to}: ${before}`];
		});

		expect(differences).toEqual([]);
	});
}

if (creator) describe(TITLE, () => consumers(creator));
else describe.skip(TITLE, () => it('needs packages/create-saas-starter of the starter', () => {}));
