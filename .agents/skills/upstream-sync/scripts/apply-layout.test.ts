import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	BASE_RULES,
	createMoveTable,
	EFFECT_LEAF_SET,
	isAllowedEdge,
	layoutOf,
	type AllowedEdge,
	type MoveRule,
	type StarterWorkspace
} from '../layout/v3';
import {
	checkTotality,
	compareEdges,
	forbiddenPairs,
	readImportEdges,
	selectRatchet,
	trackedPaths,
	UPSTREAM_CONTEXT
} from './apply-layout';

vi.setConfig({ testTimeout: 60_000 });

const SCRIPT = join(import.meta.dirname, 'apply-layout.ts');
const CHECKOUT = resolve(import.meta.dirname, '../../../..');
const NULL_GIT_CONFIG = process.platform === 'win32' ? 'NUL' : '/dev/null';

function childEnv(): NodeJS.ProcessEnv {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))
	);
	return {
		...env,
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_CONFIG_GLOBAL: NULL_GIT_CONFIG,
		GIT_AUTHOR_NAME: 'Fixture',
		GIT_AUTHOR_EMAIL: 'fixture@example.com',
		GIT_COMMITTER_NAME: 'Fixture',
		GIT_COMMITTER_EMAIL: 'fixture@example.com'
	};
}

function run(cwd: string, command: string, args: string[]) {
	const result = spawnSync(command, args, { cwd, encoding: 'utf-8', env: childEnv() });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const fixtures: string[] = [];
afterEach(() => {
	for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

/** A Git repository whose index tracks `files`, committed when `commit` names a message. */
function repository(files: Record<string, string>, commit?: string): string {
	const root = mkdtempSync(join(tmpdir(), 'apply-layout-'));
	fixtures.push(root);
	run(root, 'git', ['init', '--quiet']);
	addFiles(root, files, commit);
	return root;
}

function addFiles(root: string, files: Record<string, string>, commit?: string) {
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	run(root, 'git', ['add', '--all']);
	if (commit) run(root, 'git', ['commit', '--quiet', '-m', commit]);
}

const layout = (cwd: string, mode: string) => run(cwd, 'bun', [SCRIPT, mode]);

const ratchet = await selectRatchet(CHECKOUT);

describe('apply-layout --check', () => {
	it('maps every tracked path of this checkout', (context) => {
		if (ratchet.totality !== 'strict') return context.skip(ratchet.totality.skip);
		expect(ratchet.refusals).toEqual([]);
		const result = layout(CHECKOUT, '--check');
		expect(result.stdout).toMatch(/ tracked paths, 0 unmapped paths\n$/);
		expect(result.status).toBe(0);
	});

	it('fails on a tracked path that no rule covers', () => {
		const root = repository({ 'src/app.ts': '', 'stray/notes.md': '' });
		const result = layout(root, '--check');
		expect(result.stdout).toContain('2 tracked paths, 1 unmapped paths');
		expect(result.stdout).toContain('unmapped: stray/notes.md');
		expect(result.status).toBe(1);
	});

	it('maps a product root that the product adds in its extension', () => {
		const extension = `export default { rules: [{ from: 'voice/', to: 'apps/voice/', owner: 'voice' }] };\n`;
		const root = repository({
			'src/app.ts': '',
			'voice/server.ts': '',
			'.upstream-sync.layout.ts': extension
		});
		expect(layout(root, '--check')).toMatchObject({
			status: 0,
			stdout: '3 tracked paths, 0 unmapped paths\n'
		});
		expect(layout(root, '--renames').stdout.split('\n')).toContain(
			'voice/server.ts\tapps/voice/server.ts'
		);
	});

	it('refuses an extension rule that collides with a base rule', () => {
		const extension = `export default { rules: [{ from: 'src/lib/voice/', to: 'packages/voice/', owner: 'voice' }] };\n`;
		const root = repository({
			'src/lib/voice/server.ts': '',
			'.upstream-sync.layout.ts': extension
		});
		const result = layout(root, '--check');
		expect(result.stderr).toContain('src/lib/voice/ collides with the rule for src/');
		expect(result.status).toBe(1);
	});
});

describe('checkTotality', () => {
	const tracked = ['src/lib/utils.ts', 'src/lib/utils.test.ts', ...EFFECT_LEAF_SET];
	const withRules = (...rules: MoveRule[]) =>
		createMoveTable([
			...BASE_RULES.filter((base) => !rules.some((rule) => rule.from === base.from)),
			...rules
		]);

	it('fails when two paths land on one destination', () => {
		const table = withRules({
			from: 'src/lib/old-utils.ts',
			to: 'packages/ui/src/utils.ts',
			owner: 'ui'
		});
		expect(checkTotality(table, [...tracked, 'src/lib/old-utils.ts']).sharedDestinations).toEqual([
			['packages/ui/src/utils.ts', ['src/lib/utils.ts', 'src/lib/old-utils.ts']]
		]);
	});

	it('fails when a rule sends one Effect leaf module to another owner', () => {
		const table = withRules({
			from: 'src/lib/effect/retry.ts',
			to: 'apps/web/src/lib/effect/retry.ts',
			owner: 'web'
		});
		expect(checkTotality(table, tracked).splitSets).toEqual([
			'The Effect leaf set lands in 2 places: backend packages/backend/shared/effect, web apps/web/src/lib/effect'
		]);
	});

	it('fails when a test lands apart from its subject', () => {
		const table = withRules({
			from: 'src/lib/utils.test.ts',
			to: 'apps/web/src/lib/utils.test.ts',
			owner: 'web'
		});
		expect(checkTotality(table, tracked).splitSets).toEqual([
			'src/lib/utils.test.ts lands apart from src/lib/utils.ts'
		]);
	});

	it('rejects a rule whose destination lies in another workspace', () => {
		expect(() => withRules({ from: 'src/lib/x.ts', to: 'apps/web/x.ts', owner: 'ui' })).toThrow(
			'src/lib/x.ts is owned by ui but lands in web at apps/web/x.ts'
		);
	});

	it('keeps unknown workspaces and undeclared edges out of the types', () => {
		// @ts-expect-error `cms` is no starter workspace.
		const rule: MoveRule<StarterWorkspace> = { from: 'cms/', to: 'packages/cms/', owner: 'cms' };
		// @ts-expect-error A primitive may not depend on the app.
		const edge: AllowedEdge = ['ui', 'web'];
		expect([rule.owner, edge[1], isAllowedEdge('ui', 'web'), isAllowedEdge('web', 'ui')]).toEqual([
			'cms',
			'web',
			false,
			true
		]);
	});
});

describe('layoutOf', () => {
	it('reads the layout each revision names', () => {
		const root = repository({ 'src/app.ts': '', 'package.json': '{}' }, 'flat');
		addFiles(root, { 'apps/web/package.json': '{}' }, 'workspace');
		expect([layoutOf('HEAD~1', root), layoutOf('HEAD', root)]).toEqual(['flat', 'workspace']);
		expect(() => layoutOf('missing', root)).toThrow('missing is not a commit');
	});
});

describe('apply-layout plans', () => {
	it('lists paths left at a flat location after the move', () => {
		const root = repository({ 'apps/web/src/app.ts': '', 'scripts/static-checks.ts': '' });
		expect(layout(root, '--stragglers')).toMatchObject({ status: 0, stdout: '' });
		addFiles(root, { 'src/late.ts': '' });
		expect(layout(root, '--stragglers')).toMatchObject({ status: 1, stdout: 'src/late.ts\n' });
	});

	it('rewrites the specifiers the move breaks', () => {
		const root = repository({
			'package.json': JSON.stringify({ imports: { '#lib/*': './src/lib/*' } }),
			'src/lib/effect/errors.ts': '',
			'src/lib/confect/support/fields.ts': '',
			'src/lib/confect/x.ts':
				"import { E } from '../effect/errors';\nimport { F } from './support/fields';\n",
			'src/lib/emails/templates/types.ts':
				"import type { F } from '../../confect/support/fields';\n",
			'src/lib/components/ui/button/index.ts': '',
			'src/routes/page.ts': "import { Button } from '#lib/components/ui/button/index.js';\n",
			'src/lib/content/legal-metadata.ts': '',
			'scripts/path-sets.ts': '',
			'scripts/export-profile.ts': "import { pathSets } from './path-sets';\n",
			'scripts/template-setup.ts':
				"import { isIsoCalendarDate } from '../src/lib/content/legal-metadata';\nimport { pathSets } from './path-sets';\nimport { button } from '#lib/components/ui/button/index.js';\n",
			'scripts/dev.ts': "import { pathSets } from './path-sets';\n"
		});
		expect(layout(root, '--specifiers').stdout.trim().split('\n').sort()).toEqual([
			'apps/web/scripts/dev.ts\t./path-sets\t@repo/tooling/path-sets',
			'apps/web/src/routes/page.ts\t#lib/components/ui/button/index.js\t@repo/ui/src/components/ui/button/index.js',
			'packages/backend/confect/x.ts\t../effect/errors\t../shared/effect/errors',
			'packages/emails/src/templates/types.ts\t../../confect/support/fields\t@repo/backend/confect/support/fields',
			'scripts/export-profile.ts\t./path-sets\t../packages/tooling/src/path-sets',
			'scripts/template-setup.ts\t#lib/components/ui/button/index.js\t../packages/ui/src/components/ui/button/index.js',
			'scripts/template-setup.ts\t../src/lib/content/legal-metadata\t../apps/web/src/lib/content/legal-metadata',
			'scripts/template-setup.ts\t./path-sets\t../packages/tooling/src/path-sets'
		]);
	});

	it('prints the forbidden pairs and fails when the table does not map the checkout', () => {
		const root = repository({
			'package.json': '{}',
			'scripts/static-checks.ts': '',
			'scripts/dev.ts': "import { run } from './static-checks';\n"
		});
		expect(layout(root, '--edges')).toMatchObject({
			status: 0,
			stdout: 'scripts/dev.ts\tscripts/static-checks.ts\n'
		});
		addFiles(root, { 'stray/notes.md': '' });
		const unmapped = layout(root, '--edges');
		expect(unmapped).toMatchObject({
			status: 1,
			stdout: 'scripts/dev.ts\tscripts/static-checks.ts\n'
		});
		expect(unmapped.stderr).toContain('unmapped: stray/notes.md');
	});
});

describe('selectRatchet', () => {
	const copy = { 'package.json': JSON.stringify({ name: 'saas-starter' }), 'src/app.ts': '' };
	const extension = (body: string) =>
		`export default { rules: [{ from: 'voice/', to: 'apps/voice/', owner: 'voice' }]${body} };\n`;

	it('holds the starter table and known edges under the upstream context', async () => {
		const root = repository(copy);
		expect(await selectRatchet(root, { [UPSTREAM_CONTEXT]: '1' })).toMatchObject({
			totality: 'strict',
			knownEdges: 'starter'
		});
	});

	it('skips both checks in an unmarked copy without the upstream context', async () => {
		const root = repository({ ...copy, 'stray/notes.md': '' });
		const selected = await selectRatchet(root, {});
		const skip = { skip: expect.stringContaining(UPSTREAM_CONTEXT) };
		expect(selected).toMatchObject({ totality: skip, knownEdges: skip });
		expect(layout(root, '--check')).toMatchObject({ status: 1 });
	});

	it('holds totality in a marked product with an extension file', async () => {
		const root = repository({
			...copy,
			'.upstream-sync.json': '{}',
			'.upstream-sync.layout.ts': extension(''),
			'voice/server.ts': '',
			'desktop/main.ts': ''
		});
		const selected = await selectRatchet(root, {});
		expect(selected).toMatchObject({
			totality: 'strict',
			knownEdges: { skip: expect.stringContaining('apply-layout.ts --edges') }
		});
		expect(checkTotality(selected.table, trackedPaths(root)).unmapped).toEqual(['desktop/main.ts']);
	});

	it("compares a product's forbidden pairs with its own knownEdges", async () => {
		const root = repository({
			...copy,
			'.upstream-sync.layout.ts': extension(
				", knownEdges: [['src/lib/components/ui/a.ts', 'src/routes/x.ts']]"
			),
			'voice/server.ts': '',
			'src/routes/x.ts': '',
			'src/lib/components/ui/a.ts': "import '../../../routes/x';\n"
		});
		const found = async () => {
			const selected = await selectRatchet(root, { [UPSTREAM_CONTEXT]: '1' });
			const known = selected.knownEdges;
			if (known === 'starter' || 'skip' in known) throw new Error('no product list selected');
			return compareEdges(
				forbiddenPairs(selected.table, readImportEdges(root, trackedPaths(root))),
				known
			);
		};
		expect(await found()).toEqual({ added: [], gone: [] });
		addFiles(root, { 'src/lib/components/ui/b.ts': "import '../../../routes/x';\n" });
		expect(await found()).toEqual({
			added: ['src/lib/components/ui/b.ts -> src/routes/x.ts'],
			gone: []
		});
	});
});
