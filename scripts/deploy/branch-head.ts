import { createDeploymentExecution, throwIfStopped, type DeploymentExecution } from './execution';
import { detectPlatform } from './platform';

/** False when the build commit or the remote branch head is unknown. */
export async function isBranchHead(
	branch: string,
	execution: DeploymentExecution
): Promise<boolean> {
	const commit =
		execution.env.WORKERS_CI_COMMIT_SHA ||
		execution.env.CF_PAGES_COMMIT_SHA ||
		execution.env.VERCEL_GIT_COMMIT_SHA;
	if (!commit) return false;
	const result = await execution.run({
		command: 'git',
		args: ['ls-remote', 'origin', `refs/heads/${branch}`]
	});
	throwIfStopped(result);
	if (!result.ok) return false;
	const head = result.stdout
		.split('\n')
		.map((line) => line.split('\t'))
		.find(([, ref]) => ref === `refs/heads/${branch}`)?.[0];
	return head === commit;
}

/**
 * The shell command for `convex deploy --cmd`. The CLI runs it after it claims
 * the preview and before it pushes, and a non-zero exit stops the push. The
 * build environment names the branch and commit.
 */
export const BRANCH_HEAD_COMMAND = 'bun scripts/deploy/branch-head.ts';

if (import.meta.main) {
	const execution = createDeploymentExecution();
	const branch = detectPlatform(execution.env).gitRef;
	if (!branch || !(await isBranchHead(branch, execution))) {
		console.error(`This commit is not the head of ${branch} on origin; not pushing.`);
		process.exitCode = 1;
	}
}
