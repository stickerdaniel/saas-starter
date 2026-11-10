import { createDeploymentExecution, throwIfStopped, type DeploymentExecution } from './execution';
import { detectPlatform } from './platform';

function buildCommit(env: NodeJS.ProcessEnv): string | undefined {
	return env.WORKERS_CI_COMMIT_SHA || env.CF_PAGES_COMMIT_SHA || env.VERCEL_GIT_COMMIT_SHA;
}

/** The commit origin names as the branch head, or null when git cannot tell. */
async function originHead(branch: string, execution: DeploymentExecution): Promise<string | null> {
	const result = await execution.run({
		command: 'git',
		args: ['ls-remote', 'origin', `refs/heads/${branch}`]
	});
	throwIfStopped(result);
	if (!result.ok) return null;
	return (
		result.stdout
			.split('\n')
			.map((line) => line.split('\t'))
			.find(([, ref]) => ref === `refs/heads/${branch}`)?.[0] ?? null
	);
}

/** False when the build commit or the remote branch head is unknown. */
export async function isBranchHead(
	branch: string,
	execution: DeploymentExecution
): Promise<boolean> {
	const commit = buildCommit(execution.env);
	return !!commit && (await originHead(branch, execution)) === commit;
}

/**
 * The branch head on origin when it is another commit than this build's, else
 * null. An unknown build commit or head returns null, so a build without git
 * access deploys as before.
 */
export async function otherBranchHead(
	branch: string,
	execution: DeploymentExecution
): Promise<string | null> {
	const commit = buildCommit(execution.env);
	if (!commit) return null;
	const head = await originHead(branch, execution);
	return head && head !== commit ? head : null;
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
