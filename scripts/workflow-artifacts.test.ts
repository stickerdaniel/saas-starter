import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { sanitizedGitEnv } from './git-context';

/**
 * Actions artifacts and caches share one account-wide storage quota. When it
 * fills up, every upload across every repository fails — including uploads a
 * deployment depends on. Two habits caused past incidents: diagnostic uploads
 * without retention-days (repository default: 90 days) and uploads that run on
 * success even though their content is only read after a failure.
 *
 * This guard enforces bounded artifact retention for every workflow:
 * - every upload-artifact step declares retention-days;
 * - no retention exceeds MAX_RETENTION_DAYS;
 * - diagnostic artifacts upload only on failure and expire within
 *   DIAGNOSTIC_RETENTION_DAYS, unless the step name marks them as an explicit
 *   delivery fallback that is already gated by a failed primary delivery.
 *
 * Forks extend DIAGNOSTIC_ARTIFACTS with their own diagnostic names and list
 * deployment-critical artifacts (e.g. release manifests) in
 * LONG_LIVED_ARTIFACT_PREFIXES so they may keep MAX_RETENTION_DAYS.
 */

// Artifact names that exist purely to debug a failed run.
const DIAGNOSTIC_ARTIFACTS = new Set(['playwright-report']);

// Name prefixes of artifacts a machine consumer reads later (deploy manifests,
// audit evidence). They may upload unconditionally and keep the maximum.
const LONG_LIVED_ARTIFACT_PREFIXES: string[] = [];

const DIAGNOSTIC_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 30;

const WORKFLOWS_DIR = path.resolve(import.meta.dirname, '../.github/workflows');

interface UploadStep {
	workflow: string;
	stepName: string;
	condition: string | null;
	artifactName: string | null;
	retentionDays: number | null;
}

function parseUploadSteps(workflow: string): UploadStep[] {
	const source = fs.readFileSync(path.join(WORKFLOWS_DIR, workflow), 'utf-8');
	const lines = source.split('\n');
	const steps: UploadStep[] = [];

	for (let i = 0; i < lines.length; i++) {
		if (!/^\s*uses:\s*actions\/upload-artifact@/.test(lines[i]!)) continue;

		// Walk up to the step's dash line to find its boundary indentation and
		// any name/if keys declared before the uses line.
		let start = i;
		while (start > 0 && !/^\s*- /.test(lines[start]!)) start--;
		const dashIndent = lines[start]!.match(/^(\s*)- /)![1]!.length;

		let end = i + 1;
		while (end < lines.length) {
			const line = lines[end]!;
			const stepBoundary = new RegExp(`^\\s{${dashIndent}}- `);
			const dedent =
				line.trim() !== '' && line.search(/\S/) <= dashIndent && !stepBoundary.test(line);
			if (stepBoundary.test(line) || dedent) break;
			end++;
		}

		const block = lines.slice(start, end).join('\n');
		const stepName = block.match(/^\s*(?:- )?name:\s*(.+)$/m)?.[1]?.trim() ?? '(unnamed)';
		const condition = block.match(/^\s*(?:- )?if:\s*(.+)$/m)?.[1]?.trim() ?? null;
		const artifactName = block.match(/^\s{2,}name:\s*(.+)$/m)?.[1]?.trim() ?? null;
		const retention = block.match(/^\s*retention-days:\s*(\d+)\s*$/m)?.[1];

		steps.push({
			workflow,
			stepName,
			condition,
			artifactName,
			retentionDays: retention === undefined ? null : Number(retention)
		});
	}

	return steps;
}

const workflows = fs
	.readdirSync(WORKFLOWS_DIR)
	.filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'));

const uploads = workflows.flatMap(parseUploadSteps);

describe('workflow artifact retention', () => {
	it('finds the known upload sites (parser sanity check)', () => {
		expect(uploads.length).toBeGreaterThan(0);
		for (const upload of uploads) {
			expect(upload.artifactName, `${upload.workflow}: ${upload.stepName}`).not.toBeNull();
		}
	});

	it('bounds every artifact upload to the maximum retention', () => {
		for (const upload of uploads) {
			const label = `${upload.workflow}: ${upload.stepName}`;
			expect(upload.retentionDays, `${label} must declare retention-days`).not.toBeNull();
			expect(upload.retentionDays!, label).toBeLessThanOrEqual(MAX_RETENTION_DAYS);
		}
	});

	it('uploads diagnostic artifacts only on failure with short retention', () => {
		for (const upload of uploads) {
			const longLived = LONG_LIVED_ARTIFACT_PREFIXES.some((prefix) =>
				upload.artifactName!.startsWith(prefix)
			);
			if (longLived || !DIAGNOSTIC_ARTIFACTS.has(upload.artifactName!)) continue;
			const label = `${upload.workflow}: ${upload.stepName}`;
			expect(upload.condition, `${label} must be failure-gated`).toMatch(/failure\(\)/);
			expect(upload.retentionDays!, label).toBeLessThanOrEqual(DIAGNOSTIC_RETENTION_DAYS);
		}
	});

	it('classifies every artifact name (no unreviewed upload sites)', () => {
		for (const upload of uploads) {
			const label = `${upload.workflow}: ${upload.stepName} (${upload.artifactName})`;
			const known =
				DIAGNOSTIC_ARTIFACTS.has(upload.artifactName!) ||
				LONG_LIVED_ARTIFACT_PREFIXES.some((prefix) => upload.artifactName!.startsWith(prefix));
			expect(
				known,
				`${label} — add it to DIAGNOSTIC_ARTIFACTS or LONG_LIVED_ARTIFACT_PREFIXES`
			).toBe(true);
		}
	});
});

describe('docker build records', () => {
	it('disables build-record artifacts wherever build-push-action is used', () => {
		for (const workflow of workflows) {
			const source = fs.readFileSync(path.join(WORKFLOWS_DIR, workflow), 'utf-8');
			if (!source.includes('docker/build-push-action')) continue;
			// Build records create two retained artifacts per build; digests and
			// registry tags are the authoritative build evidence.
			expect(source, workflow).toContain('DOCKER_BUILD_RECORD_UPLOAD: false');
		}
	});
});

describe.skipIf(process.platform === 'win32')('lint job source identity', () => {
	const lintSteps = (() => {
		const workflow = parseYaml(
			fs.readFileSync(path.join(WORKFLOWS_DIR, 'static-checks.yml'), 'utf-8')
		) as { jobs?: Record<string, { steps?: unknown }> };
		const steps = workflow.jobs?.lint?.steps;
		if (!Array.isArray(steps)) throw new TypeError('the lint job carried no step list');
		return steps as Array<{ name?: string; run?: string }>;
	})();

	const guards = lintSteps.filter((step) => step.name?.startsWith('Assert source identity'));

	function git(cwd: string, args: string[]): string {
		const result = spawnSync('git', args, {
			cwd,
			encoding: 'utf-8',
			env: sanitizedGitEnv()
		});
		if (result.status !== 0) throw new Error(result.stderr);
		return result.stdout.trim();
	}

	function fixture(): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-identity-'));
		git(dir, ['init', '-q', '-b', 'main']);
		git(dir, ['config', 'user.email', 'guard@example.test']);
		git(dir, ['config', 'user.name', 'Guard Fixture']);
		git(dir, ['config', 'commit.gpgsign', 'false']);
		fs.writeFileSync(path.join(dir, '.gitignore'), 'generated/\nsrc/env.d.ts\n');
		fs.mkdirSync(path.join(dir, 'src'));
		fs.writeFileSync(path.join(dir, 'src', 'env.d.ts'), 'export {};\n');
		fs.writeFileSync(path.join(dir, 'app.ts'), 'export const version = 1;\n');
		git(dir, ['add', '-A', '-f']);
		git(dir, ['commit', '-q', '-m', 'base']);
		return dir;
	}

	function exec(script: string, dir: string, sha: string): number {
		const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
			cwd: dir,
			env: { ...sanitizedGitEnv(), GITHUB_SHA: sha },
			encoding: 'utf-8'
		});
		return result.status ?? 1;
	}

	function withoutGuard(script: string, marker: string): string {
		const lines = script.split('\n');
		const start = lines.findIndex(
			(line) => line.trimStart().startsWith('if ') && line.includes(marker)
		);
		const end = lines.findIndex((line, index) => index > start && line.trim() === 'fi');
		if (start < 0 || end <= start) throw new Error(`no guard block around ${marker}`);
		return [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n');
	}

	function withInlinedStatus(script: string): string {
		return script
			.replace(/^\t*status="[^\n]*\n/m, '')
			.replace(
				'if [ -n "$status" ]',
				'if [ -n "$(git status --porcelain=v1 --untracked-files=all)" ]'
			);
	}

	function onEachGuard(dir: string, sha: string, expected: number): void {
		expect(guards, 'the lint job carries both guard steps').toHaveLength(2);
		for (const guard of guards) {
			expect(exec(String(guard.run), dir, sha), String(guard.name)).toBe(expected);
		}
	}

	function inFixture(body: (dir: string, head: string) => void): void {
		const dir = fixture();
		try {
			body(dir, git(dir, ['rev-parse', 'HEAD']));
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}

	it('reasserts the source identity after install and after the checks', () => {
		expect(guards.map((step) => step.name)).toEqual([
			'Assert source identity after install',
			'Assert source identity after checks'
		]);
		const installIndex = lintSteps.findIndex((step) => step.run === 'bun install');
		expect(installIndex).toBeGreaterThanOrEqual(0);
		expect(lintSteps[installIndex + 1]?.name).toBe('Assert source identity after install');
		expect(lintSteps.at(-1)?.name).toBe('Assert source identity after checks');
		expect(String(guards[0]?.run)).toBe(String(guards[1]?.run));
	});

	it('accepts the tree the event commit describes', () => {
		inFixture((dir, head) => onEachGuard(dir, head, 0));
	});

	it('rejects a tracked file that a generator rewrote, ignored or not', () => {
		inFixture((dir, head) => {
			fs.writeFileSync(path.join(dir, 'src', 'env.d.ts'), 'export const generated = true;\n');
			onEachGuard(dir, head, 1);
		});
	});

	it('rejects a staged change', () => {
		inFixture((dir, head) => {
			fs.writeFileSync(path.join(dir, 'app.ts'), 'export const version = 2;\n');
			git(dir, ['add', 'app.ts']);
			onEachGuard(dir, head, 1);
		});
	});

	it('rejects a new file no ignore rule covers', () => {
		inFixture((dir, head) => {
			fs.writeFileSync(path.join(dir, 'report.txt'), 'left behind\n');
			onEachGuard(dir, head, 1);
		});
	});

	it('accepts ignored generator output', () => {
		inFixture((dir, head) => {
			fs.mkdirSync(path.join(dir, 'generated'));
			fs.writeFileSync(path.join(dir, 'generated', 'out.js'), 'export const built = true;\n');
			onEachGuard(dir, head, 0);
		});
	});

	it('rejects a clean tree once HEAD left the event commit', () => {
		inFixture((dir, head) => {
			fs.writeFileSync(path.join(dir, 'app.ts'), 'export const version = 2;\n');
			git(dir, ['add', '-A']);
			git(dir, ['commit', '-q', '-m', 'second']);
			onEachGuard(dir, head, 1);
		});
	});

	it('fails the job when the index cannot be read at all', () => {
		inFixture((dir, head) => {
			fs.writeFileSync(path.join(dir, '.git', 'index'), 'DIRC');
			expect(git(dir, ['rev-parse', 'HEAD'])).toBe(head);
			expect(guards, 'the lint job carries both guard steps').toHaveLength(2);
			for (const guard of guards) {
				expect(exec(String(guard.run), dir, head), String(guard.name)).not.toBe(0);
			}
		});
	});

	it('owes the unreadable index to the separate status capture', () => {
		const script = String(guards[0]?.run);
		inFixture((dir, head) => {
			fs.writeFileSync(path.join(dir, '.git', 'index'), 'DIRC');
			expect(exec(script, dir, head)).not.toBe(0);
			expect(exec(withInlinedStatus(script), dir, head)).toBe(0);
		});
	});

	it('owes each rejection to its own guard', () => {
		const script = String(guards[0]?.run);
		inFixture((dir, head) => {
			fs.writeFileSync(path.join(dir, 'src', 'env.d.ts'), 'export const generated = true;\n');
			expect(exec(script, dir, head)).toBe(1);
			expect(exec(withoutGuard(script, '-n "$status"'), dir, head)).toBe(0);
		});
		inFixture((dir, head) => {
			fs.writeFileSync(path.join(dir, 'app.ts'), 'export const version = 2;\n');
			git(dir, ['add', '-A']);
			git(dir, ['commit', '-q', '-m', 'second']);
			expect(exec(script, dir, head)).toBe(1);
			expect(exec(withoutGuard(script, '"$head" != "$GITHUB_SHA"'), dir, head)).toBe(0);
		});
	});
});
