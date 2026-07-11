/**
 * Strip resolved values of sensitive env vars out of a varlock manifest.
 *
 * `@varlock/vite-integration`'s `resolved-env` SSR inject mode serializes the whole
 * resolved manifest into the server bundle (`globalThis.__varlockLoadedEnv = {...}`),
 * including the plaintext `value` of every var marked `@sensitive`. That bundle ships
 * to the edge and is readable from the deployed artifact, so any write-only platform
 * secret present at build time (Convex deploy keys, management token, build-time-only
 * API keys) is exposed there even though nothing at runtime reads it.
 *
 * Dropping the `value` keeps the entry and its `isSensitive` flag, so the runtime
 * `initVarlockEnv()` still registers the key (as `undefined`) — byte-for-byte the same
 * shape a var that is simply unset already serializes to. No runtime read depends on a
 * sensitive value from this manifest: SvelteKit server code reads private vars via
 * `$env/dynamic/private` (the platform's own `process.env`), and the sensitive vars in
 * this schema are either build/deploy-only or consumed by the separate Convex backend.
 */
type ManifestItem = { value?: unknown; isSensitive?: boolean };
type EnvManifest = { config?: Record<string, ManifestItem> } | undefined | null;

export function stripSensitiveManifestValues<T extends EnvManifest>(manifest: T): T {
	if (!manifest?.config) return manifest;
	for (const item of Object.values(manifest.config)) {
		if (item?.isSensitive) delete item.value;
	}
	return manifest;
}
