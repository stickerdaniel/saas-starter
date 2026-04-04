/**
 * CF Workers deploy command — wraps `wrangler versions upload` with preview alias support.
 *
 * For preview branches, passes --preview-alias with a sanitized branch name
 * so CF Workers creates a valid alias even for branches starting with digits.
 *
 * Set as the non-production deploy command in CF Workers Builds dashboard.
 */

import { spawnSync } from 'child_process';
import { sanitizeBranchAlias } from './deploy/platform';

const branch = process.env.WORKERS_CI_BRANCH;
const productionBranch = process.env.PRODUCTION_BRANCH || 'main';
const isPreview = branch !== undefined && branch !== productionBranch;

const args = ['wrangler', 'versions', 'upload'];

if (isPreview && branch) {
	const alias = sanitizeBranchAlias(branch);
	args.push('--preview-alias', alias);
	console.log(`Preview alias: ${alias}`);
}

const result = spawnSync('bunx', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
