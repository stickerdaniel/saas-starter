/**
 * CF Workers production deploy command — wraps `varlock-wrangler deploy`, then purges the
 * Cloudflare edge cache.
 *
 * `varlock-wrangler` is a thin wrapper around `wrangler`: it resolves the env graph and
 * uploads it to the worker (non-sensitive values as vars, sensitive ones as secrets, plus
 * the __VARLOCK_ENV blob the runtime loader reads at boot). Without it the worker deploys
 * with no env at all, since the Cloudflare build embeds no env in the SSR bundle.
 *
 * Older deploys allowed marketing HTML shells into the Cloudflare edge cache.
 * A plain `wrangler deploy` uploads the new version but never invalidates those
 * existing entries, so visitors could keep getting old HTML until the TTL expired.
 * Purging after a successful deploy clears those legacy entries; current HTML
 * responses are `Cache-Control: public, no-cache` so new shells do not persist
 * across deploys.
 *
 * Set as the production deploy command in CF Workers Builds dashboard.
 * The purge is a no-op unless both CF_PURGE_TOKEN and CF_ZONE_ID are set, so forks
 * without a custom domain keep plain deploy behavior.
 *
 * This script itself is not run under `varlock run`, so CF_PURGE_TOKEN gets no log
 * redaction here (varlock-wrangler resolves the env graph in its own child process, which
 * does not cover this process). CF_PURGE_TOKEN must never be written to any log/error
 * string; it is only ever sent in the Authorization header below.
 */

import { reportCliFailure, withCliSignals } from './deploy/cli';
import {
	checkAborted,
	createDeploymentExecution,
	DeploymentError,
	requestJson,
	requireCommand
} from './deploy/execution';

export async function main(execution = createDeploymentExecution()): Promise<void> {
	requireCommand(
		await execution.run({
			command: 'bunx',
			args: ['varlock-wrangler', 'deploy'],
			output: 'inherit'
		}),
		'Cloudflare deployment failed.'
	);
	const token = execution.env.CF_PURGE_TOKEN;
	const zoneId = execution.env.CF_ZONE_ID;
	if (!token || !zoneId) {
		console.log('Cache purge skipped (CF_PURGE_TOKEN / CF_ZONE_ID not set).');
		return;
	}
	checkAborted(execution.signal);
	// Already published: purge failures remain non-blocking and must not cause
	// another deployment. Explicit parent cancellation is still terminal.
	try {
		const body = await requestJson(
			`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/purge_cache`,
			{
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ purge_everything: true })
			},
			execution
		);
		if (
			typeof body !== 'object' ||
			body === null ||
			!('success' in body) ||
			body.success !== true
		) {
			console.warn('Cache purge failed; the worker is already deployed.');
			return;
		}
		console.log('Cloudflare edge cache purged.');
	} catch (error) {
		if (error instanceof DeploymentError && error.code === 'aborted') throw error;
		console.warn('Cache purge request failed; the worker is already deployed.');
	}
}

export async function runCloudflareProductionCli(
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
	await withCliSignals((signal) =>
		runCloudflareProductionCli(createDeploymentExecution({ signal }))
	);
}
