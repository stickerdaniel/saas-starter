import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { sanitizedGitEnv } from './git-context';
import {
	evaluate,
	interpolate,
	isTruthy,
	toText,
	type ExpressionContexts,
	type ExpressionValue
} from './github-expression';

/**
 * Actions artifacts and caches share one account-wide storage quota. When it
 * fills up, every upload across every repository fails — including uploads a
 * deployment depends on. Diagnostic uploads without retention-days use the
 * repository default of 90 days, accumulating reports beyond their useful life.
 *
 * This guard enforces bounded artifact retention for every workflow:
 * - every upload-artifact step declares retention-days;
 * - no retention exceeds MAX_RETENTION_DAYS;
 * - diagnostic artifacts expire within DIAGNOSTIC_RETENTION_DAYS, including
 *   passing Playwright runs whose retry traces and timings remain useful.
 *
 * Forks extend DIAGNOSTIC_ARTIFACTS with their own diagnostic names and list
 * deployment-critical artifacts (e.g. release manifests) in
 * LONG_LIVED_ARTIFACT_PREFIXES so they may keep MAX_RETENTION_DAYS.
 */

// Short-lived reports, including retries hidden by an overall successful run.
const DIAGNOSTIC_ARTIFACTS = new Set(['playwright-report']);

// Name prefixes of artifacts a machine consumer reads later (deploy manifests,
// audit evidence). They may upload unconditionally and keep the maximum.
const LONG_LIVED_ARTIFACT_PREFIXES = ['create-saas-starter-'];

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

	it('keeps diagnostic artifacts on short retention', () => {
		for (const upload of uploads) {
			const longLived = LONG_LIVED_ARTIFACT_PREFIXES.some((prefix) =>
				upload.artifactName!.startsWith(prefix)
			);
			if (longLived || !DIAGNOSTIC_ARTIFACTS.has(upload.artifactName!)) continue;
			const label = `${upload.workflow}: ${upload.stepName}`;
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

interface WorkflowConcurrency {
	group: string;
	'cancel-in-progress'?: unknown;
	queue?: string;
}

interface WorkflowJob {
	name?: string;
	uses?: string;
	'timeout-minutes'?: unknown;
	concurrency?: WorkflowConcurrency | string;
}

interface WorkflowFile {
	name?: string;
	on: string | string[] | Record<string, { paths?: unknown; 'paths-ignore'?: unknown } | null>;
	concurrency?: WorkflowConcurrency | string;
	jobs: Record<string, WorkflowJob>;
}

const parsedWorkflows = new Map(
	workflows.map((file) => [
		file,
		parseYaml(fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf-8')) as WorkflowFile
	])
);

function parsedWorkflow(file: string): WorkflowFile {
	const workflow = parsedWorkflows.get(file);
	if (!workflow) throw new Error(`${file} is not a workflow in ${WORKFLOWS_DIR}`);
	return workflow;
}

function triggers(
	workflow: WorkflowFile
): Record<string, { paths?: unknown; 'paths-ignore'?: unknown }> {
	const on = workflow.on;
	const events = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on);
	return Object.fromEntries(
		events.map((event) => [
			event,
			(typeof on === 'object' && !Array.isArray(on) && on[event]) || {}
		])
	);
}

describe('workflow job timeouts', () => {
	// A job without timeout-minutes holds its runner for GitHub's six-hour default
	// when a step hangs. A job that only calls a reusable workflow cannot set one;
	// the callee's own jobs are checked as workflows of their own.
	it('bounds every executable job with timeout-minutes', () => {
		for (const [file, workflow] of parsedWorkflows) {
			for (const [id, job] of Object.entries(workflow.jobs)) {
				if (job.uses) continue;
				const timeout = job['timeout-minutes'];
				expect(
					typeof timeout === 'number' && timeout > 0,
					`${file}: job ${id} must declare timeout-minutes, sized at two to three times its observed p90`
				).toBe(true);
			}
		}
	});
});

describe('GitHub expression evaluation', () => {
	const contexts = {
		github: { run_attempt: '1', event: { pull_request: { number: 7 } }, ref: 'refs/heads/main' }
	};

	it.each([
		['github.run_attempt == 1', true],
		["github.ref == 'REFS/HEADS/MAIN'", true],
		['github.event.missing == null', true],
		['github.event.pull_request.number || github.run_id', 7],
		["github.event.missing && 'x' || 'fallback'", 'fallback'],
		["!(github.run_attempt != '1')", true],
		["contains('Preview Alias URL', 'alias')", true],
		["format('{0}-{{x}}', github.event.pull_request.number)", '7-{x}']
	])('evaluates %s like the runner', (expression, expected) => {
		expect(evaluate(expression, contexts)).toEqual(expected);
	});

	it.each([
		"startsWith(github.ref, 'refs/')",
		'github.run_attempt > 1',
		'github.event.*.number',
		'vars.E2E_RUNNER'
	])('refuses the unmodelled expression %s', (expression) => {
		expect(() => evaluate(expression, contexts)).toThrow();
	});
});

/**
 * Supersede policy for validation runs a pull request triggers.
 *
 * A newer first-attempt run for the same pull request or preview identity
 * cancels the older one, so stale work stops holding runners. A rerun gets a
 * group of its own: rerunning an older run must not cancel the current head's
 * checks, and a newer push must not cancel a rerun someone asked for. Where the
 * event names the pull request's current head (check_run), a build that
 * completes after a newer push must not cancel the newer head's run either.
 *
 * Groups are evaluated from event fixtures shaped like real payloads, so the
 * policy follows what GitHub computes rather than how the expression reads.
 */

const REPOSITORY = 'stickerdaniel/saas-starter';
const MAIN_SHA = '7ff20deb5c83d5300191b2d8bc97e9d91b456f8e';
const OLDER_HEAD = 'd7fa9318054279ab4a03811807c0fc4f4fc50209';
const NEWER_HEAD = '53788f8c9bb606f1f97426c404d13a8d229b718f';

interface RunFixture {
	pr: number;
	head: string;
	runId: string;
	attempt?: number;
}

function githubContexts(
	workflow: string,
	eventName: string,
	event: ExpressionValue,
	ref: string,
	run: RunFixture
): ExpressionContexts {
	return {
		github: {
			workflow,
			event_name: eventName,
			event,
			ref,
			repository: REPOSITORY,
			run_id: run.runId,
			// The runner exposes both as strings.
			run_attempt: String(run.attempt ?? 1)
		},
		inputs: {},
		vars: {}
	};
}

function branchOf(pr: number): string {
	return pr === 1276 ? 'renovate/npm-better-auth-vulnerability' : `fix/pr-${pr}`;
}

// Shape of `gh api repos/stickerdaniel/saas-starter/pulls/1276` (the webhook's
// pull_request object), trimmed to the fields workflows read. pull_request_target
// carries the same payload but runs on the base branch.
function pullRequestEvent(
	workflow: string,
	run: RunFixture,
	eventName: 'pull_request' | 'pull_request_target' = 'pull_request'
): ExpressionContexts {
	const repo = { full_name: REPOSITORY };
	const event = {
		action: 'synchronize',
		number: run.pr,
		pull_request: {
			number: run.pr,
			state: 'open',
			head: { ref: branchOf(run.pr), sha: run.head, repo },
			base: { ref: 'main', sha: MAIN_SHA, repo },
			user: { login: 'renovate[bot]' }
		}
	};
	const ref = eventName === 'pull_request' ? `refs/pull/${run.pr}/merge` : 'refs/heads/main';
	return githubContexts(workflow, eventName, event, ref, run);
}

// Shape of the Cloudflare check run 122484880911 on PR 1276 (`gh api
// repos/stickerdaniel/saas-starter/commits/<sha>/check-runs`). The webhook embeds
// the full check suite, whose head_branch comes from `gh api .../check-suites/<id>`.
// pull_requests[].head.sha is the pull request's head when the event fires, which
// is how a late build of an older commit tells itself apart.
function checkRunEvent(
	workflow: string,
	run: RunFixture & { build?: string; associated?: boolean }
): ExpressionContexts {
	const repo = {
		id: 1040341837,
		name: 'saas-starter',
		url: `https://api.github.com/repos/${REPOSITORY}`
	};
	const build = run.build ?? run.head;
	const event = {
		action: 'completed',
		check_run: {
			id: 122484880911,
			name: 'Workers Builds: saas-starter',
			head_sha: build,
			status: 'completed',
			conclusion: 'success',
			app: { id: 85455, slug: 'cloudflare-workers-and-pages' },
			check_suite: { id: 110015208275, head_branch: branchOf(run.pr), head_sha: build },
			output: {
				title: 'Workers Builds: saas-starter',
				summary: 'Preview Alias URL: https://example'
			},
			pull_requests:
				run.associated === false
					? []
					: [
							{
								id: 5039515423,
								number: run.pr,
								url: `https://api.github.com/repos/${REPOSITORY}/pulls/${run.pr}`,
								head: { ref: branchOf(run.pr), sha: run.head, repo },
								base: { ref: 'main', sha: MAIN_SHA, repo }
							}
						]
		}
	};
	// check_run workflows run on the default branch.
	return githubContexts(workflow, 'check_run', event, 'refs/heads/main', run);
}

interface SupersedeCase {
	older: ExpressionContexts;
	newer: ExpressionContexts;
	otherPr: ExpressionContexts;
	rerun: ExpressionContexts;
	// Runs for the same pull request that must not cancel the newer head's run.
	stale: Array<[string, ExpressionContexts]>;
}

function pullRequestCases(workflow: string): SupersedeCase {
	return {
		older: pullRequestEvent(workflow, { pr: 1276, head: OLDER_HEAD, runId: '40809070601' }),
		newer: pullRequestEvent(workflow, { pr: 1276, head: NEWER_HEAD, runId: '40809070663' }),
		otherPr: pullRequestEvent(workflow, { pr: 1280, head: NEWER_HEAD, runId: '40809070700' }),
		rerun: pullRequestEvent(workflow, {
			pr: 1276,
			head: OLDER_HEAD,
			runId: '40809070601',
			attempt: 2
		}),
		stale: []
	};
}

const SUPERSEDE_CASES: Record<string, (workflow: string) => SupersedeCase> = {
	pull_request: pullRequestCases,
	// A callee inherits its caller's event and payload; github.workflow names the caller.
	workflow_call: (workflow) => pullRequestCases(`${workflow} caller`),
	check_run: (workflow) => ({
		older: checkRunEvent(workflow, { pr: 1276, head: OLDER_HEAD, runId: '40809222801' }),
		newer: checkRunEvent(workflow, { pr: 1276, head: NEWER_HEAD, runId: '40809222845' }),
		otherPr: checkRunEvent(workflow, { pr: 1280, head: NEWER_HEAD, runId: '40809222900' }),
		rerun: checkRunEvent(workflow, {
			pr: 1276,
			head: OLDER_HEAD,
			runId: '40809222801',
			attempt: 2
		}),
		stale: [
			[
				'a build of the older commit completing after the newer push',
				checkRunEvent(workflow, {
					pr: 1276,
					head: NEWER_HEAD,
					build: OLDER_HEAD,
					runId: '40809222950'
				})
			],
			[
				'a build without pull request association',
				checkRunEvent(workflow, {
					pr: 1276,
					head: NEWER_HEAD,
					associated: false,
					runId: '40809222990'
				})
			]
		]
	})
};

// Validation events a pull request causes. deployment_status is listed without
// cases: its payload names no pull request or current head, so such a workflow
// needs an exemption that states how it serializes instead.
const PR_VALIDATION_EVENTS = new Set([...Object.keys(SUPERSEDE_CASES), 'deployment_status']);

function resolveConcurrency(
	concurrency: WorkflowConcurrency | string | undefined,
	contexts: ExpressionContexts
): { group: string; cancel: boolean; queue: string | undefined } | undefined {
	if (concurrency === undefined) return undefined;
	const declared = typeof concurrency === 'string' ? { group: concurrency } : concurrency;
	return {
		group: toText(interpolate(declared.group, contexts)),
		cancel: isTruthy(interpolate(declared['cancel-in-progress'] ?? false, contexts)),
		queue: declared.queue
	};
}

// A deployment as `gh api repos/stickerdaniel/saas-starter/deployments` returns it,
// with the status the webhook adds, as seen by a job after `prepare` ran.
function deploymentStatusJob(workflow: string, backendKey: string, runId: string) {
	const ref = branchOf(1276);
	const event = {
		action: 'created',
		deployment: { id: 6690704384, sha: NEWER_HEAD, ref, environment: 'Preview', task: 'deploy' },
		deployment_status: {
			state: 'success',
			environment: 'Preview',
			environment_url: 'https://saas-starter-git-preview.vercel.app'
		}
	};
	return {
		...githubContexts(workflow, 'deployment_status', event, `refs/heads/${ref}`, {
			pr: 1276,
			head: NEWER_HEAD,
			runId
		}),
		needs: { prepare: { outputs: { 'backend-key': backendKey } } }
	};
}

function expectQueuedPerKey(
	concurrency: WorkflowConcurrency | string | undefined,
	first: ExpressionContexts,
	second: ExpressionContexts,
	other: ExpressionContexts
): void {
	const [a, b, c] = [first, second, other].map((contexts) =>
		resolveConcurrency(concurrency, contexts)
	);
	expect(a, 'declares concurrency').toBeDefined();
	expect(b!.group, 'the same identity shares one group').toBe(a!.group);
	expect(b!.cancel, 'a later run queues instead of cancelling').toBe(false);
	expect(b!.queue, 'every queued run waits its turn').toBe('max');
	expect(c!.group, 'another identity runs independently').not.toBe(a!.group);
}

// Workflows that keep a queue or serialization instead of superseding. Each
// entry asserts the behaviour it keeps, so an exemption cannot hide a gap.
const SUPERSEDE_EXEMPTIONS: Record<string, (workflow: WorkflowFile) => void> = {
	// pull_request_target: each run deploys the fork's preview backend and then
	// tests it, so pushes to one fork PR queue rather than cancel a deploy midway.
	'e2e-fork-preview.yml': (workflow) => {
		const event = (pr: number, head: string, runId: string) =>
			pullRequestEvent(workflow.name!, { pr, head, runId }, 'pull_request_target');
		expectQueuedPerKey(
			workflow.concurrency,
			event(1276, OLDER_HEAD, '1'),
			event(1276, NEWER_HEAD, '2'),
			event(1280, NEWER_HEAD, '3')
		);
	},
	// deployment_status names no pull request or current head, so a workflow group
	// cannot tell a late older deployment from the newest one and would let it
	// cancel the newer run. The shared preview backend queues per job instead.
	'e2e-preview-vercel.yml': (workflow) => {
		expect(workflow.concurrency, 'no workflow group may cancel a newer deployment').toBeUndefined();
		expectQueuedPerKey(
			workflow.jobs.exclusive?.concurrency,
			deploymentStatusJob(workflow.name!, 'backend-a', '1'),
			deploymentStatusJob(workflow.name!, 'backend-a', '2'),
			deploymentStatusJob(workflow.name!, 'backend-b', '3')
		);
	},
	// Runs only when a pull request closes and deletes its preview backend; a
	// later run for the same pull request waits instead of cancelling a deletion.
	'delete-convex-preview.yml': (workflow) => {
		const [first, second, other] = [
			pullRequestEvent(workflow.name!, { pr: 1276, head: OLDER_HEAD, runId: '1' }),
			pullRequestEvent(workflow.name!, { pr: 1276, head: NEWER_HEAD, runId: '2' }),
			pullRequestEvent(workflow.name!, { pr: 1280, head: NEWER_HEAD, runId: '3' })
		].map((contexts) => resolveConcurrency(workflow.concurrency, contexts));
		expect(second!.group).toBe(first!.group);
		expect(second!.cancel, 'a deletion is never cancelled').toBe(false);
		expect(other!.group).not.toBe(first!.group);
	}
};

describe('pull request run supersession', () => {
	const inScope = [...parsedWorkflows].filter(([, workflow]) =>
		Object.keys(triggers(workflow)).some((event) => PR_VALIDATION_EVENTS.has(event))
	);

	it('finds the pull request validation workflows (parser sanity check)', () => {
		expect(inScope.map(([file]) => file)).toContain('static-checks.yml');
		expect(inScope.map(([file]) => file)).toContain('e2e-preview-cf.yml');
	});

	it.each(Object.keys(SUPERSEDE_EXEMPTIONS))('keeps the exempt queue of %s', (file) => {
		SUPERSEDE_EXEMPTIONS[file]!(parsedWorkflow(file));
	});

	const checked = inScope.flatMap(([file, workflow]) =>
		Object.keys(triggers(workflow))
			.filter((event) => PR_VALIDATION_EVENTS.has(event) && !(file in SUPERSEDE_EXEMPTIONS))
			.map((event) => [file, event] as const)
	);

	it.each(checked)('%s supersedes older %s runs and isolates reruns', (file, event) => {
		const workflow = parsedWorkflow(file);
		const cases = SUPERSEDE_CASES[event];
		expect(
			cases,
			`${file}: ${event} carries no pull request identity; add it to SUPERSEDE_EXEMPTIONS with the serialization it keeps`
		).toBeDefined();
		const scenario = cases!(workflow.name ?? file);
		const resolve = (contexts: ExpressionContexts) =>
			resolveConcurrency(workflow.concurrency, contexts);
		const newer = resolve(scenario.newer);
		expect(
			newer,
			`${file}: declare a workflow concurrency group keyed by the pull request, with github.run_attempt == 1 && <pr> || github.run_id`
		).toBeDefined();
		expect(resolve(scenario.older)!.group, 'a newer run joins the older run of its PR').toBe(
			newer!.group
		);
		expect(newer!.cancel, 'a newer run cancels the older run of its PR').toBe(true);
		expect(resolve(scenario.otherPr)!.group, 'another PR keeps its own group').not.toBe(
			newer!.group
		);
		const rerun = resolve(scenario.rerun)!.group;
		expect(
			[resolve(scenario.older)!.group, newer!.group],
			'a rerun gets its own group (github.run_attempt == 1 && <pr> || github.run_id)'
		).not.toContain(rerun);
		for (const [label, contexts] of scenario.stale) {
			expect(resolve(contexts)!.group, `${label} must not cancel the newer head`).not.toBe(
				newer!.group
			);
		}
	});
});

interface CheckProducer {
	workflow: string;
	job: string;
	// A check run carries the job's name; a status is posted by a step of the job.
	reports: 'check-run' | 'status';
}

const checkRun = (workflow: string, job: string): CheckProducer => ({
	workflow,
	job,
	reports: 'check-run'
});
const status = (workflow: string, job: string): CheckProducer => ({
	workflow,
	job,
	reports: 'status'
});

// Mirrors the required status checks of main (`gh api
// repos/stickerdaniel/saas-starter/branches/main/protection/required_status_checks`),
// each mapped to the jobs that report it. A fork with other required checks
// updates this map alongside its branch protection.
const REQUIRED_CHECK_PRODUCERS: Record<string, readonly CheckProducer[]> = {
	'Lint & Format': [checkRun('static-checks.yml', 'lint')],
	'Type Check': [checkRun('static-checks.yml', 'typecheck')],
	'Unit Tests': [checkRun('static-checks.yml', 'unit-tests')],
	'Upstream Report Tests': [checkRun('static-checks.yml', 'upstream-report-tests')],
	'Regression Guard Verdict': [checkRun('require-regression-guard.yml', 'check')],
	'Windows Process Lifecycle': [checkRun('windows-process-lifecycle.yml', 'lifecycle')],
	'PR Title': [checkRun('check-pr-title.yml', 'check')],
	'English PR Metadata': [checkRun('require-english-pr.yml', 'english-metadata')],
	'check-bot-coauthors': [checkRun('check-attribution.yml', 'check-bot-coauthors')],
	// Cloudflare's app reports it for same-repo PRs; fork PRs get it from the fork preview.
	'Workers Builds: saas-starter': [status('e2e-fork-preview.yml', 'aggregate')],
	'E2E Tests': [
		status('e2e-preview-cf.yml', 'e2e-skipped'),
		status('e2e-preview-cf.yml', 'e2e-build-failed'),
		status('e2e-preview-cf.yml', 'aggregate'),
		status('e2e-preview-vercel.yml', 'e2e-deploy-failed'),
		status('e2e-preview-vercel.yml', 'aggregate'),
		status('e2e-fork-preview.yml', 'aggregate')
	]
};

describe('required check producers', () => {
	const producers = Object.entries(REQUIRED_CHECK_PRODUCERS).flatMap(([context, list]) =>
		list.map((producer) => [context, `${producer.workflow} ${producer.job}`, producer] as const)
	);

	it.each(producers)('%s is reported by %s', (context, _label, producer) => {
		const job = parsedWorkflow(producer.workflow).jobs[producer.job];
		expect(job, `${producer.workflow} has no job ${producer.job}`).toBeDefined();
		if (producer.reports === 'check-run') expect(job!.name ?? producer.job).toBe(context);
	});

	// GitHub never starts a workflow whose path filter excludes every changed
	// file, so its required check stays pending and blocks the merge. A producer
	// that only matters for some paths decides inside the job and still reports.
	it.each([...new Set(producers.map(([, , producer]) => producer.workflow))])(
		'%s runs for every change',
		(file) => {
			for (const [event, filter] of Object.entries(triggers(parsedWorkflow(file)))) {
				expect(
					filter.paths ?? filter['paths-ignore'],
					`${file}: on.${event} produces a required check and must not filter paths`
				).toBeUndefined();
			}
		}
	);
});

describe.skipIf(process.platform === 'win32')('required Unit Tests check', () => {
	const workflow = parseYaml(
		fs.readFileSync(path.join(WORKFLOWS_DIR, 'static-checks.yml'), 'utf-8')
	) as {
		jobs: Record<string, { name: string; steps: Array<{ run?: string }> }>;
	};
	const check = Object.values(workflow.jobs).find((job) => job.name === 'Unit Tests');

	it('preserves the required Unit Tests status name', () => {
		expect(check, 'Keep the required Unit Tests aggregate check').toBeDefined();
	});

	it.each(['success', 'failure', 'cancelled', 'skipped', ''])(
		'reports the shard result %j without accepting missing tests',
		(result) => {
			const script = check?.steps.find((step) => step.run)?.run;
			expect(script).toBeDefined();
			const execution = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script!], {
				env: { ...sanitizedGitEnv(), SHARD_RESULT: result },
				encoding: 'utf8',
				timeout: 5_000
			});
			expect(execution.status, `${execution.stdout}${execution.stderr}`).toBe(
				result === 'success' ? 0 : 1
			);
			if (result !== 'success') {
				expect(execution.stdout).toContain('Every unit test shard must pass');
			}
		}
	);
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

	function run(script: string, dir: string, sha: string): { status: number; stderr: string } {
		const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
			cwd: dir,
			env: { ...sanitizedGitEnv(), GITHUB_SHA: sha },
			encoding: 'utf-8',
			maxBuffer: 16 * 1024 * 1024
		});
		return { status: result.status ?? 1, stderr: result.stderr };
	}

	function exec(script: string, dir: string, sha: string): number {
		return run(script, dir, sha).status;
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
		const installIndex = lintSteps.findIndex(
			(step) => step.run === 'bun install --frozen-lockfile'
		);
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

	it('prints the diff of a rewritten tracked file before it fails', () => {
		inFixture((dir, head) => {
			fs.writeFileSync(path.join(dir, 'src', 'env.d.ts'), 'export const generated = true;\n');
			expect(guards, 'the lint job carries both guard steps').toHaveLength(2);
			for (const guard of guards) {
				const result = run(String(guard.run), dir, head);
				expect(result.status, String(guard.name)).toBe(1);
				expect(result.stderr, String(guard.name)).toMatch(/src\/env\.d\.ts \| 2 \+-/);
				expect(result.stderr, String(guard.name)).toContain(
					'-export {};\n+export const generated = true;\n'
				);
			}
		});
	});

	it('bounds the printed diff of a large rewrite', () => {
		inFixture((dir, head) => {
			fs.writeFileSync(
				path.join(dir, 'app.ts'),
				`export const version = 1;\n${'// generated line\n'.repeat(100_000)}`
			);
			for (const guard of guards) {
				const result = run(String(guard.run), dir, head);
				expect(result.status, String(guard.name)).toBe(1);
				expect(result.stderr, String(guard.name)).toMatch(/app\.ts \| 100000 \+/);
				expect(result.stderr.length, String(guard.name)).toBeLessThan(30_000);
			}
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
