/**
 * Prepare a varlock manifest for embedding in a non-Cloudflare server bundle.
 *
 * `@varlock/vite-integration`'s `resolved-env` SSR inject mode serializes the whole
 * resolved manifest into the server bundle (`globalThis.__varlockLoadedEnv = {...}`),
 * including the plaintext `value` (and, for non-string types, the `envStr` form) of every
 * var marked `@sensitive`. That bundle ships to the host and is readable from the deployed
 * artifact, so any write-only platform secret present at build time (Convex deploy keys,
 * management token, build-time-only API keys) is exposed there even though nothing at
 * runtime reads it. Dropping both forms keeps the entry and its `isSensitive` flag, so the
 * runtime `initVarlockEnv()` still registers the key, byte-for-byte the same shape a var
 * that is simply unset already serializes to.
 *
 * At startup that runtime writes the manifest into `process.env`. With the schema's
 * `@injectUndefinedAsEmpty`, every valueless entry, stripped or unset at build time, would
 * become an empty string and overwrite the value the host provides at runtime, such as
 * `CONVEX_INTERNAL_URL` on a self-hosted Docker network. Turning the setting off in the
 * embedded copy leaves those host values in place (the manifest is marked
 * `injectedAtBuild`, so absent entries are not deleted either). Build-time and CLI loads
 * keep the schema's setting, so statically inlined public values are unaffected.
 */
type ManifestItem = { value?: unknown; envStr?: string; isSensitive?: boolean };
type EnvManifest =
	| { config?: Record<string, ManifestItem>; settings?: { injectUndefinedAsEmpty?: boolean } }
	| undefined
	| null;

export function prepareEmbeddedEnvManifest<T extends EnvManifest>(manifest: T): T {
	if (!manifest?.config) return manifest;
	for (const item of Object.values(manifest.config)) {
		if (!item?.isSensitive) continue;
		delete item.value;
		delete item.envStr;
	}
	manifest.settings = { ...manifest.settings, injectUndefinedAsEmpty: false };
	return manifest;
}
