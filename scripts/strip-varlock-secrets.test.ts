import { afterEach, describe, expect, it } from 'vitest';
import { initVarlockEnv } from 'varlock/env';
import { prepareEmbeddedEnvManifest } from './strip-varlock-secrets';

const HOST_KEYS = ['CONVEX_INTERNAL_URL', 'PUBLIC_CONVEX_URL', 'VARLOCK_ENV', 'AUTUMN_TIMEOUT'];

function fixture() {
	return {
		settings: { redactLogs: true, injectUndefinedAsEmpty: true },
		config: {
			PUBLIC_CONVEX_URL: { value: 'https://example.convex.cloud', isSensitive: false },
			CONVEX_DEPLOY_KEY: { value: 'prod:secret-deploy-key', isSensitive: true },
			CONVEX_MANAGEMENT_TOKEN: { value: 'mgmt-token', isSensitive: true },
			CONVEX_INTERNAL_URL: { value: 'http://build-host:3210', isSensitive: true },
			// Non-string values also carry their environment-string form.
			AUTUMN_TIMEOUT: { value: 31415, envStr: '31415', isSensitive: true },
			// Already-unset sensitive var: no value key at all
			SENTRY_AUTH_TOKEN: { isSensitive: true },
			VARLOCK_ENV: { value: 'production', isSensitive: false }
		}
	};
}

/** Boot varlock's real runtime from an embedded manifest, as a server bundle does. */
function bootFromEmbeddedManifest(manifest: ReturnType<typeof fixture>) {
	const global = globalThis as { __varlockLoadedEnv?: unknown };
	global.__varlockLoadedEnv = { ...manifest, injectedAtBuild: true };
	try {
		initVarlockEnv();
	} finally {
		delete global.__varlockLoadedEnv;
	}
}

// varlock snapshots process.env at first import and restores that snapshot before every
// later init, so a value the test sets afterwards only survives when the manifest keeps it.
const hostSnapshot = (
	globalThis as { __varlockEnvState?: { originalProcessEnv: Record<string, string | undefined> } }
).__varlockEnvState?.originalProcessEnv;
const savedHostEnv = Object.fromEntries(HOST_KEYS.map((key) => [key, hostSnapshot?.[key]]));
afterEach(() => {
	for (const [key, value] of Object.entries(savedHostEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	if (hostSnapshot) Object.assign(hostSnapshot, savedHostEnv);
});

describe('prepareEmbeddedEnvManifest', () => {
	it('leaves no sensitive build-time value anywhere in the serialized manifest', () => {
		const serialized = JSON.stringify(prepareEmbeddedEnvManifest(fixture()));
		for (const secret of ['prod:secret-deploy-key', 'mgmt-token', 'build-host', '31415']) {
			expect(serialized, secret).not.toContain(secret);
		}
	});

	it('keeps non-sensitive values and every key with its isSensitive flag', () => {
		const original = fixture();
		const prepared = prepareEmbeddedEnvManifest(fixture());
		expect(prepared.config.PUBLIC_CONVEX_URL.value).toBe('https://example.convex.cloud');
		expect(Object.keys(prepared.config)).toEqual(Object.keys(original.config));
		for (const key of Object.keys(original.config) as Array<keyof typeof original.config>) {
			expect(prepared.config[key].isSensitive, key).toBe(original.config[key].isSensitive);
		}
	});

	it('serializes a stripped var the same as an already-unset sensitive var', () => {
		const prepared = prepareEmbeddedEnvManifest(fixture());
		expect(prepared.config.CONVEX_DEPLOY_KEY).toEqual(prepared.config.SENTRY_AUTH_TOKEN);
	});

	it('keeps a value the host provides at runtime', () => {
		process.env.CONVEX_INTERNAL_URL = 'http://convex:3210';
		if (hostSnapshot) hostSnapshot.CONVEX_INTERNAL_URL = 'http://convex:3210';
		bootFromEmbeddedManifest(prepareEmbeddedEnvManifest(fixture()));
		expect(process.env.CONVEX_INTERNAL_URL).toBe('http://convex:3210');
		expect(process.env.PUBLIC_CONVEX_URL).toBe('https://example.convex.cloud');
	});

	it('leaves a value the host does not provide unset', () => {
		delete process.env.CONVEX_INTERNAL_URL;
		if (hostSnapshot) delete hostSnapshot.CONVEX_INTERNAL_URL;
		bootFromEmbeddedManifest(prepareEmbeddedEnvManifest(fixture()));
		expect(process.env.CONVEX_INTERNAL_URL).toBeUndefined();
	});

	it('tolerates a missing or empty manifest', () => {
		expect(prepareEmbeddedEnvManifest(undefined)).toBeUndefined();
		expect(prepareEmbeddedEnvManifest(null)).toBeNull();
		expect(prepareEmbeddedEnvManifest({})).toEqual({});
	});
});
