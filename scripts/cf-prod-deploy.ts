/**
 * CF Workers production deploy command — wraps `wrangler deploy`, then purges the
 * Cloudflare edge cache.
 *
 * Marketing routes that aren't prerendered are edge-cached by the handleCacheControl
 * hook (`Cache-Control: public, s-maxage=3600, ...`). A plain `wrangler deploy` uploads
 * the new version but never invalidates that cache, so visitors keep getting the old HTML
 * until the TTL expires. Purging after a successful deploy makes the new version live
 * immediately.
 *
 * Set as the production deploy command in CF Workers Builds dashboard.
 * The purge is a no-op unless both CF_PURGE_TOKEN and CF_ZONE_ID are set, so forks
 * without a custom domain keep plain `wrangler deploy` behaviour.
 */

import { spawnSync } from 'child_process';

const result = spawnSync('bunx', ['wrangler', 'deploy'], { stdio: 'inherit' });
if (result.status !== 0) {
	process.exit(result.status ?? 1);
}

const token = process.env.CF_PURGE_TOKEN;
const zoneId = process.env.CF_ZONE_ID;

if (!token || !zoneId) {
	console.log('Cache purge skipped (CF_PURGE_TOKEN / CF_ZONE_ID not set).');
	process.exit(0);
}

const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
	method: 'POST',
	headers: {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json'
	},
	body: JSON.stringify({ purge_everything: true })
});

const body = (await res.json().catch(() => null)) as { success?: boolean; errors?: unknown } | null;

// The worker is already published at this point. A failed purge only means the edge
// serves stale HTML until the TTL expires (the pre-existing behaviour), so log loudly
// but don't fail the build and risk a confusing retry of an already-live deploy.
if (!res.ok || !body?.success) {
	console.error(`Cache purge failed (HTTP ${res.status}):`, JSON.stringify(body));
	process.exit(0);
}

console.log('Cloudflare edge cache purged.');
