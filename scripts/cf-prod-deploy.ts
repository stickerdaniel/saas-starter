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
 * without a custom domain keep plain `wrangler deploy` behavior.
 *
 * Runs without varlock (like the other deploy commands), so CF_PURGE_TOKEN gets no
 * log redaction. It must never be written to any log/error string; it is only ever
 * sent in the Authorization header below.
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

// The worker is already published at this point, so the purge is fail-open: any failure
// (HTTP error or a network-level throw like DNS/connection refused/timeout) only means the
// edge serves stale HTML until the TTL expires (the pre-existing behavior). Log loudly but
// exit 0 so the build doesn't fail and trigger a confusing retry of an already-live deploy.
// purge_everything is intentional: the zone only caches non-prerendered marketing HTML, so a
// full purge is the simplest correct invalidation; a tag/prefix purge could miss stale paths.
try {
	const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ purge_everything: true })
	});

	const body = (await res.json().catch(() => null)) as {
		success?: boolean;
		errors?: unknown;
	} | null;

	if (!res.ok || !body?.success) {
		console.error(`Cache purge failed (HTTP ${res.status}):`, JSON.stringify(body));
		process.exit(0);
	}

	console.log('Cloudflare edge cache purged.');
} catch (err) {
	console.error('Cache purge request failed (network error):', err);
	process.exit(0);
}
