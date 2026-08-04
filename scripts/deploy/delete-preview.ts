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
import { deletePreviewForBranch } from './prune-previews';

const { values } = parseArgs({ options: { branch: { type: 'string' } }, strict: true });
const branch = values.branch;
if (!branch) {
	console.error('delete-preview: --branch <gitRef> is required');
	process.exit(2);
}

const token = process.env.CONVEX_MANAGEMENT_TOKEN;
const projectId = process.env.CONVEX_PROJECT_ID;
if (!token || !projectId) {
	console.error(
		'delete-preview: CONVEX_MANAGEMENT_TOKEN and CONVEX_PROJECT_ID must be set; skipping.'
	);
	// Not a failure of this PR: without credentials there is nothing to do, and a
	// fork PR (no secrets) must not fail the workflow.
	process.exit(0);
}

const result = await deletePreviewForBranch({ token, projectId, gitRef: branch });

if (result.deleted) {
	console.log(`Deleted preview deployment ${result.deleted} for branch ${branch}`);
	process.exit(0);
}
if (result.reason === 'not_found') {
	console.log(`No preview deployment for branch ${branch} (already gone) — nothing to do.`);
	process.exit(0);
}
console.error(`delete-preview failed for branch ${branch}: ${result.reason}`);
process.exit(1);
