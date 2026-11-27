// @vitest-environment node
// Runs the real fork-point and change-list scripts against throwaway repositories
// built here. A local repository stands in for the template: each fork rewrites the
// default GitHub URL to it with `url.<path>.insteadOf`, so nothing touches the network.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000 });

const FORK_POINT = join(import.meta.dirname, 'find-fork-point.ts');
const LIST_CHANGES = join(import.meta.dirname, 'list-upstream-changes.ts');
const UPSTREAM_URL = 'https://github.com/stickerdaniel/saas-starter.git';
const NULL_GIT_CONFIG = process.platform === 'win32' ? 'NUL' : '/dev/null';

function childEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (!key.toUpperCase().startsWith('GIT_')) env[key] = value;
	}
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

function git(cwd: string, args: string[]): string {
	const r = spawnSync('git', args, { cwd, encoding: 'utf-8', env: childEnv() });
	if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
	return r.stdout.trim();
}

function bunRun(cwd: string, script: string) {
	return spawnSync('bun', [script, '--json'], {
		cwd,
		encoding: 'utf-8',
		env: childEnv(),
		timeout: 30_000
	});
}

function bunJson(cwd: string, script: string): { json: Record<string, unknown>; stderr: string } {
	const r = bunRun(cwd, script);
	if (r.status !== 0) throw new Error(`${script} exited ${r.status}: ${r.stderr}`);
	return { json: JSON.parse(r.stdout), stderr: r.stderr };
}

function listedSubjects(cwd: string): string[] {
	const listed = bunJson(cwd, LIST_CHANGES).json as { commits: Array<{ subject: string }> };
	return listed.commits.map((c) => c.subject);
}

const SCAFFOLD = (sha: string) =>
	JSON.stringify({ version: 1, source: 'stickerdaniel/saas-starter', ref: 'main', sha });

function writeFiles(dir: string, files: Record<string, string>): void {
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), content);
	}
}

function commitAll(dir: string, subject: string): string {
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-q', '--no-verify', '-m', subject]);
	return git(dir, ['rev-parse', 'HEAD']);
}

// Setup deletes the maintainer CLI, so a fork tree without it sits closer to U1,
// which never had it, than to the commit it was really copied from.
const CLI_SOURCE = Array.from({ length: 30 }, (_, i) => `export const line${i} = ${i};`).join('\n');
const U1 = { 'README.md': '# Template\n', 'src/app.ts': 'export const v = 1;\n' };
const U2 = { ...U1, 'src/app.ts': 'export const v = 2;\n', 'packages/cli/index.ts': CLI_SOURCE };
const U3 = { ...U2, 'src/extra.ts': 'export const extra = true;\n' };
const U4 = { ...U3, 'src/app.ts': 'export const v = 4;\n' };

let root: string;
let upstream: string;
let shas: { u1: string; u2: string; u3: string; u4: string };

function newFork(name: string): string {
	const dir = join(root, name);
	mkdirSync(dir);
	git(dir, ['init', '-q', '-b', 'main']);
	git(dir, ['config', `url.${upstream}.insteadOf`, UPSTREAM_URL]);
	return dir;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'find-fork-point-'));
	upstream = join(root, 'upstream');
	mkdirSync(upstream);
	git(upstream, ['init', '-q', '-b', 'main']);
	const snapshots = [U1, U2, U3, U4];
	const made: string[] = [];
	snapshots.forEach((files, i) => {
		rmSync(join(upstream, 'packages'), { recursive: true, force: true });
		writeFiles(upstream, files);
		made.push(commitAll(upstream, `feat: upstream ${i + 1}`));
	});
	shas = { u1: made[0]!, u2: made[1]!, u3: made[2]!, u4: made[3]! };
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('find-fork-point', () => {
	it('uses the CLI scaffold sha when setup rebranded the first commit', () => {
		const fork = newFork('cli');
		writeFiles(fork, { ...U1, 'src/app.ts': U2['src/app.ts'], 'README.md': '# My product\n' });
		writeFiles(fork, {
			'.saas-starter-scaffold.json': JSON.stringify({
				version: 1,
				state: 'ready',
				phase: 'complete',
				source: 'stickerdaniel/saas-starter',
				ref: 'main',
				sha: shas.u2,
				cliVersion: '0.0.0',
				archiveSha256: '0'.repeat(64)
			})
		});
		commitAll(fork, 'chore: initial commit');

		const { json } = bunJson(fork, FORK_POINT);
		expect(json.method).toBe('.saas-starter-scaffold.json sha');
		expect(json.forkPoint).toBe(shas.u2);
		expect(json.candidateCount).toBe(2);
	});

	it('refuses a scaffold marker that names another source', () => {
		const fork = newFork('foreign-cli');
		writeFiles(fork, {
			...U3,
			'README.md': '# My product\n',
			'.saas-starter-scaffold.json': JSON.stringify({ source: 'someone/else', sha: shas.u1 })
		});
		commitAll(fork, 'chore: initial commit');

		const { json, stderr } = bunJson(fork, FORK_POINT);
		expect(stderr).toContain('Ignoring .saas-starter-scaffold.json');
		expect(json.method).toMatch(/^closest-tree GUESS/);
		expect(json.forkPoint).toBe(shas.u3);
	});

	it('reads the scaffold marker as first committed after a later edit', () => {
		const fork = newFork('edited-cli');
		writeFiles(fork, {
			...U1,
			'src/app.ts': U2['src/app.ts'],
			'README.md': '# My product\n',
			'.saas-starter-scaffold.json': SCAFFOLD(shas.u2)
		});
		commitAll(fork, 'chore: initial commit');
		writeFiles(fork, { '.saas-starter-scaffold.json': SCAFFOLD(shas.u4) });
		commitAll(fork, 'chore: touch marker');

		const { json, stderr } = bunJson(fork, FORK_POINT);
		expect(stderr).toContain('edited after its first commit');
		expect(json.method).toBe('.saas-starter-scaffold.json sha');
		expect(json.forkPoint).toBe(shas.u2);
		expect(listedSubjects(fork)).toEqual(['feat: upstream 3', 'feat: upstream 4']);
	});

	function cloneAt(name: string, sha: string): string {
		const fork = join(root, name);
		git(root, ['clone', '-q', '--origin', 'upstream', upstream, fork]);
		git(fork, ['config', `url.${upstream}.insteadOf`, UPSTREAM_URL]);
		git(fork, ['reset', '-q', '--hard', sha]);
		return fork;
	}

	it('keeps the original fork point of a shared-history clone after a merge', () => {
		const fork = cloneAt('clone', shas.u2);
		writeFiles(fork, { 'README.md': '# My product\n' });
		commitAll(fork, 'chore: rebrand');
		git(fork, ['merge', '-q', '--no-edit', '--no-verify', 'upstream/main']);
		writeFiles(fork, { 'src/product.ts': 'export const product = true;\n' });
		commitAll(fork, 'feat: product feature');

		const { json } = bunJson(fork, FORK_POINT);
		expect(json.method).toMatch(/^shared history \(first-parent fork point\) UNCONFIRMED/);
		expect(json.forkPoint).toBe(shas.u2);
		expect(json.candidateCount).toBe(2);

		// The merge brought U4's bytes in, but only a recorded sync ends its review.
		writeFiles(fork, { '.upstream-sync.json': JSON.stringify({ lastSynced: shas.u3 }) });
		expect(listedSubjects(fork)).toEqual(['feat: upstream 4']);
	});

	it('lists a PR that upstream merged with a merge commit as one change', () => {
		git(upstream, ['checkout', '-q', '-b', 'feature']);
		writeFiles(upstream, { 'src/merged.ts': 'export const merged = 1;\n' });
		commitAll(upstream, 'wip: first draft');
		writeFiles(upstream, { 'src/merged.ts': 'export const merged = 2;\n' });
		commitAll(upstream, 'wip: fix the draft');
		git(upstream, ['checkout', '-q', 'main']);
		git(upstream, [
			'merge',
			'-q',
			'--no-ff',
			'--no-verify',
			'-m',
			'feat: merged PR (#9)',
			'feature'
		]);

		const fork = cloneAt('merge-pr', shas.u4);
		writeFiles(fork, { '.upstream-sync.json': JSON.stringify({ lastSynced: shas.u4 }) });
		commitAll(fork, 'chore: record sync');

		const listed = bunJson(fork, LIST_CHANGES).json as {
			commits: Array<{ subject: string; files: number }>;
		};
		expect(listed.commits).toEqual([
			expect.objectContaining({ subject: 'feat: merged PR (#9)', files: 1 })
		]);
		expect(bunJson(fork, FORK_POINT).json.candidateCount).toBe(1);
	});

	it('keeps the setup-recorded fork point across a fast-forward sync', () => {
		const fork = cloneAt('ff-recorded', shas.u2);
		// What `bun run setup` writes right after creation, before the first own commit.
		writeFiles(fork, { '.upstream-sync.json': JSON.stringify({ forkPoint: shas.u2 }) });
		git(fork, ['merge', '-q', '--ff-only', 'upstream/main']);
		writeFiles(fork, { 'README.md': '# My product\n' });
		commitAll(fork, 'chore: rebrand');

		const { json } = bunJson(fork, FORK_POINT);
		expect(json.method).toBe('.upstream-sync.json forkPoint');
		expect(json.forkPoint).toBe(shas.u2);
		expect(listedSubjects(fork)).toEqual(['feat: upstream 3', 'feat: upstream 4']);
	});

	it('labels the fork point unconfirmed after an unrecorded fast-forward sync', () => {
		const fork = cloneAt('ff-unrecorded', shas.u2);
		git(fork, ['merge', '-q', '--ff-only', 'upstream/main']);
		writeFiles(fork, { 'README.md': '# My product\n' });
		commitAll(fork, 'chore: rebrand');

		const { json } = bunJson(fork, FORK_POINT);
		expect(json.method).toMatch(/UNCONFIRMED.*CONFIRM it, then record it as forkPoint/);
	});

	it('stops in a checkout that lacks the last sync marker from origin', () => {
		const forkOrigin = cloneAt('fork-origin', shas.u2);
		writeFiles(forkOrigin, { '.upstream-sync.json': JSON.stringify({ lastSynced: shas.u2 }) });
		commitAll(forkOrigin, 'chore: record sync');
		const shared = join(root, 'shared');
		git(root, ['clone', '-q', forkOrigin, shared]);
		git(shared, ['config', `url.${upstream}.insteadOf`, UPSTREAM_URL]);
		writeFiles(forkOrigin, { '.upstream-sync.json': JSON.stringify({ lastSynced: shas.u3 }) });
		commitAll(forkOrigin, 'chore: advance sync');

		for (const script of [FORK_POINT, LIST_CHANGES]) {
			const r = bunRun(shared, script);
			expect(r.status).toBe(1);
			expect(r.stderr).toContain('chore: advance sync');
			expect(r.stderr).toContain('bun run worktree chore/upstream-sync');
		}
		git(shared, ['pull', '-q', '--ff-only']);
		expect(bunJson(shared, FORK_POINT).json.candidateCount).toBe(1);
		expect(listedSubjects(shared)).toEqual(['feat: upstream 4']);
	});

	it('finds the newer marker on a non-main trunk the local refs do not track', () => {
		const forkOrigin = cloneAt('master-origin', shas.u2);
		git(forkOrigin, ['branch', '-q', '-m', 'master']);
		writeFiles(forkOrigin, { '.upstream-sync.json': JSON.stringify({ lastSynced: shas.u2 }) });
		commitAll(forkOrigin, 'chore: record sync');
		const shared = join(root, 'untracked');
		git(root, ['clone', '-q', forkOrigin, shared]);
		git(shared, ['remote', 'set-head', 'origin', '-d']);
		git(shared, ['remote', 'set-branches', 'origin', 'feature']);
		writeFiles(forkOrigin, { '.upstream-sync.json': JSON.stringify({ lastSynced: shas.u3 }) });
		commitAll(forkOrigin, 'chore: advance sync');

		const r = bunRun(shared, LIST_CHANGES);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain('chore: advance sync');
	});

	it('stops when origin cannot be fetched to check the marker', () => {
		const fork = cloneAt('unreachable-origin', shas.u2);
		git(fork, ['remote', 'add', 'origin', join(root, 'missing-origin')]);

		for (const script of [FORK_POINT, LIST_CHANGES]) {
			const r = bunRun(fork, script);
			expect(r.status).toBe(1);
			expect(r.stderr).toContain('Could not fetch origin');
		}
	});

	it.each(['forkPoint', 'lastSynced'])('stops on a recorded %s outside upstream', (field) => {
		const fork = cloneAt(`bad-${field}`, shas.u2);
		writeFiles(fork, { 'README.md': '# My product\n' });
		const ownCommit = commitAll(fork, 'chore: rebrand');
		for (const bad of ['a'.repeat(40), ownCommit]) {
			writeFiles(fork, { '.upstream-sync.json': JSON.stringify({ [field]: bad }) });
			const r = bunRun(fork, FORK_POINT);
			expect(r.status).toBe(1);
			expect(r.stderr).toContain(`${field} "${bad}" is not a commit reachable from upstream/main`);
			expect(r.stdout).toBe('');
		}
	});

	it('stops in a shallow clone instead of treating it as a content copy', () => {
		const fork = join(root, 'shallow');
		git(root, [
			'clone',
			'-q',
			'--depth',
			'1',
			'--origin',
			'upstream',
			pathToFileURL(upstream).href,
			fork
		]);
		git(fork, ['config', `url.${upstream}.insteadOf`, UPSTREAM_URL]);
		writeFiles(fork, { 'README.md': '# My product\n' });
		commitAll(fork, 'chore: rebrand');

		const r = bunRun(fork, FORK_POINT);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain('shallow clone');
		expect(r.stderr).toContain('git fetch --unshallow');
		expect(r.stdout).toBe('');
	});

	it('keeps the omitted field when --mark-synced records a sync', () => {
		const fork = cloneAt('mark-omitted', shas.u2);
		writeFiles(fork, {
			'.upstream-sync.json': JSON.stringify({ forkPoint: shas.u2, omitted: ['tests'] })
		});
		commitAll(fork, 'chore: record setup');

		const r = spawnSync('bun', [FORK_POINT, '--mark-synced', shas.u3], {
			cwd: fork,
			encoding: 'utf-8',
			env: childEnv(),
			timeout: 30_000
		});

		expect(r.status, r.stderr).toBe(0);
		expect(JSON.parse(readFileSync(join(fork, '.upstream-sync.json'), 'utf-8'))).toMatchObject({
			forkPoint: shas.u2,
			lastSynced: shas.u3,
			omitted: ['tests']
		});
	});

	describe('a project that omits the test suite', () => {
		beforeEach(() => {
			writeFiles(upstream, { 'src/app.test.ts': 'test 1\n' });
			commitAll(upstream, 'test: cover the app');
			writeFiles(upstream, {
				'src/app.ts': 'export const v = 5;\n',
				'src/app.test.ts': 'test 2\n'
			});
			commitAll(upstream, 'fix: app and its test');
		});

		function consumer(name: string, marker: Record<string, unknown>): string {
			const fork = cloneAt(name, shas.u4);
			writeFiles(fork, {
				'.upstream-sync.json': JSON.stringify({ lastSynced: shas.u4, ...marker })
			});
			commitAll(fork, 'chore: record sync');
			return fork;
		}

		it('labels a test-only commit omitted-only and lists the mixed one as before', () => {
			const fork = consumer('omits-tests', { omitted: ['tests'] });

			const listed = bunJson(fork, LIST_CHANGES).json as {
				commits: Array<Record<string, unknown>>;
			};
			const text = spawnSync('bun', [LIST_CHANGES], {
				cwd: fork,
				encoding: 'utf-8',
				env: childEnv()
			});

			expect(listed.commits.map(({ subject, omittedOnly }) => ({ subject, omittedOnly }))).toEqual([
				{ subject: 'test: cover the app', omittedOnly: true },
				{ subject: 'fix: app and its test', omittedOnly: undefined }
			]);
			expect(text.stdout).toMatch(/test: cover the app \(omitted-only\)\n/);
			expect(text.stdout).toMatch(/fix: app and its test\n/);
		});

		function labelOf(fork: string, subject: string): unknown {
			const listed = bunJson(fork, LIST_CHANGES).json as {
				commits: Array<Record<string, unknown>>;
			};
			return listed.commits.find((commit) => commit.subject === subject)?.omittedOnly;
		}

		it('labels a commit omitted-only when its only path has non-ASCII characters', () => {
			writeFiles(upstream, { 'e2e/日本語.ts': 'export {};\n' });
			commitAll(upstream, 'test: add a support file');

			expect(
				labelOf(consumer('non-ascii', { omitted: ['tests'] }), 'test: add a support file')
			).toBe(true);
		});

		it.skipIf(process.platform === 'win32')(
			'labels a commit omitted-only when its only path holds a newline',
			() => {
				writeFiles(upstream, { 'e2e/line\nbreak.ts': 'export {};\n' });
				commitAll(upstream, 'test: add a support file');

				expect(
					labelOf(consumer('newline', { omitted: ['tests'] }), 'test: add a support file')
				).toBe(true);
			}
		);

		it('does not label a rename of shared code into the suite omitted-only', () => {
			writeFiles(upstream, { 'src/shared/helpers.ts': CLI_SOURCE });
			commitAll(upstream, 'feat: add helpers');
			mkdirSync(join(upstream, 'e2e'));
			git(upstream, ['mv', 'src/shared/helpers.ts', 'e2e/support.ts']);
			commitAll(upstream, 'refactor: move helpers into the suite');

			const listed = bunJson(consumer('rename-in', { omitted: ['tests'] }), LIST_CHANGES).json as {
				commits: Array<Record<string, unknown>>;
			};

			const moved = listed.commits.find(
				({ subject }) => subject === 'refactor: move helpers into the suite'
			);

			expect([moved?.files, moved?.categories, moved?.omittedOnly]).toEqual([
				1,
				['tests'],
				undefined
			]);
		});

		it('labels a rename inside the suite omitted-only', () => {
			writeFiles(upstream, { 'e2e/helpers.ts': CLI_SOURCE });
			commitAll(upstream, 'test: add helpers');
			git(upstream, ['mv', 'e2e/helpers.ts', 'e2e/support.ts']);
			commitAll(upstream, 'test: rename helpers');

			expect(
				labelOf(consumer('rename-inside', { omitted: ['tests'] }), 'test: rename helpers')
			).toBe(true);
		});

		it('lists the same commits without the label for a project that keeps the suite', () => {
			const omits = bunJson(consumer('omits', { omitted: ['tests'] }), LIST_CHANGES).json;
			const keeps = bunJson(consumer('keeps', {}), LIST_CHANGES).json as {
				commits: Array<Record<string, unknown>>;
			};

			expect(keeps.commits.some((commit) => 'omittedOnly' in commit)).toBe(false);
			expect(keeps.commits.map(({ subject }) => subject)).toEqual([
				'test: cover the app',
				'fix: app and its test'
			]);
			expect(omits.count).toBe(keeps.commits.length);
		});
	});

	it('matches a content copy whose first commit is an exact upstream tree', () => {
		const fork = newFork('template-copy');
		writeFiles(fork, U3);
		commitAll(fork, 'Initial commit');

		const { json } = bunJson(fork, FORK_POINT);
		expect(json.method).toBe('exact-tree');
		expect(json.forkPoint).toBe(shas.u3);
	});

	it('still guesses for an edited bootstrap commit without a marker', () => {
		const fork = newFork('edited-copy');
		writeFiles(fork, { ...U3, 'README.md': '# My product\n' });
		commitAll(fork, 'Initial commit');

		const { json } = bunJson(fork, FORK_POINT);
		expect(json.method).toMatch(/^closest-tree GUESS/);
		expect(json.forkPoint).toBe(shas.u3);
	});
});
