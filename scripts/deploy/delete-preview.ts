#!/usr/bin/env bun
/**
 * Delete the Convex preview deployment for one git branch.
 *
 * Thin adapter over deletePreviewForBranch in prune-previews.ts, invoked by the
 * delete-convex-preview.yml workflow on pull_request:closed. Reads the
 * management token + project id from the environment (GitHub secret/variable);
 * never logs them or any response body. Idempotent: a branch whose preview is
 * already gone exits 0. Ambiguity or a list/delete error exits non-zero so the
 * workflow surfaces it red rather than forcing an unsafe delete.
 */
import { parseArgs } from 'node:util';
import { reportCliFailure, withCliSignals } from './cli';
import { createDeploymentExecution, DeploymentError } from './execution';
import { deletePreviewForBranch, previewManagement, type PruneDeps } from './prune-previews';

class UsageError extends DeploymentError {
	constructor() {
		super('configuration', 'delete-preview: --branch <gitRef> is required');
	}
}

export async function main(
	args = process.argv.slice(2),
	execution = createDeploymentExecution(),
	management: PruneDeps = previewManagement
): Promise<void> {
	const { values } = parseArgs({ args, options: { branch: { type: 'string' } }, strict: true });
	const branch = values.branch;
	if (!branch) throw new UsageError();
	const token = execution.env.CONVEX_MANAGEMENT_TOKEN;
	const projectId = execution.env.CONVEX_PROJECT_ID;
	if (!token || !projectId) {
		console.log(
			'delete-preview: CONVEX_MANAGEMENT_TOKEN and CONVEX_PROJECT_ID must be set; skipping.'
		);
		return;
	}
	const result = await deletePreviewForBranch({
		token,
		projectId,
		gitRef: branch,
		deps: management,
		execution
	});
	if (result.deleted !== null) {
		console.log(`Deleted preview deployment ${result.deleted} for branch ${branch}`);
	} else if (result.reason === 'not_found') {
		console.log(`No preview deployment for branch ${branch} (already gone) — nothing to do.`);
	} else {
		throw new DeploymentError('prune_blocked', `delete-preview failed: ${result.reason}.`);
	}
}

if (import.meta.main) {
	await withCliSignals((signal) => main(undefined, createDeploymentExecution({ signal }))).catch(
		(error) => {
			reportCliFailure(error);
			process.exitCode = error instanceof UsageError ? 2 : 1;
		}
	);
}
