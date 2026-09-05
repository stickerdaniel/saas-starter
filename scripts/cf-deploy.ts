/**
 * CF Workers deploy command — wraps `varlock-wrangler versions upload` with preview alias
 * support.
 *
 * For preview branches, passes --preview-alias with a sanitized branch name
 * so CF Workers creates a valid alias even for branches starting with digits.
 *
 * `varlock-wrangler` is a thin wrapper around `wrangler`: it resolves the env graph and
 * uploads it to the worker (non-sensitive values as vars, sensitive ones as secrets, plus
 * the __VARLOCK_ENV blob the runtime loader reads at boot). Without it the worker deploys
 * with no env at all, since the Cloudflare build embeds no env in the SSR bundle.
 *
 * Set as the non-production deploy command in CF Workers Builds dashboard.
 */

import { reportCliFailure, withCliSignals } from './deploy/cli';
import { createDeploymentExecution, DeploymentError, requireCommand } from './deploy/execution';
import { sanitizeBranchAlias } from './deploy/platform';

export async function main(execution = createDeploymentExecution()): Promise<void> {
	const branch = execution.env.WORKERS_CI_BRANCH;
	const productionBranch = execution.env.PRODUCTION_BRANCH || 'main';
	const isPreview = branch !== undefined && branch !== productionBranch;
	const args = ['varlock-wrangler', 'versions', 'upload'];
	if (isPreview && branch) {
		const workerName = execution.env.WORKERS_NAME;
		if (!workerName)
			throw new DeploymentError(
				'configuration',
				'WORKERS_NAME is required to compute the preview alias slice limit.'
			);
		const alias = sanitizeBranchAlias(branch, workerName);
		args.push('--preview-alias', alias);
		console.log(`Preview alias: ${alias}`);
	}
	requireCommand(
		await execution.run({ command: 'bunx', args, output: 'inherit' }),
		'Cloudflare version upload failed.'
	);
}

export async function runCloudflareDeployCli(
	execution = createDeploymentExecution()
): Promise<void> {
	try {
		await main(execution);
	} catch (error) {
		reportCliFailure(error);
		process.exitCode = error instanceof DeploymentError ? (error.exitCode ?? 1) : 1;
	}
}

if (import.meta.main) {
	await withCliSignals((signal) => runCloudflareDeployCli(createDeploymentExecution({ signal })));
}
