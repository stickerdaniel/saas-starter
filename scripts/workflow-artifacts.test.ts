import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

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
