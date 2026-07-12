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

import { spawnSync } from 'child_process';
import { sanitizeBranchAlias } from './deploy/platform';

const branch = process.env.WORKERS_CI_BRANCH;
const productionBranch = process.env.PRODUCTION_BRANCH || 'main';
const isPreview = branch !== undefined && branch !== productionBranch;

const args = ['varlock-wrangler', 'versions', 'upload'];

if (isPreview && branch) {
	const workerName = process.env.WORKERS_NAME;
	if (!workerName) {
		console.error('WORKERS_NAME is required to compute the preview alias slice limit.');
		process.exit(1);
	}
	const alias = sanitizeBranchAlias(branch, workerName);
	args.push('--preview-alias', alias);
	console.log(`Preview alias: ${alias}`);
}

const result = spawnSync('bunx', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
