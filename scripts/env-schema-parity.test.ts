import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('local capability profile ownership', () => {
	const viteSource = fs.readFileSync(
		path.resolve(import.meta.dirname, '..', 'vite.config.ts'),
		'utf-8'
	);

	it('strips a local-file profile and writes the launcher profile last', () => {
		expect(viteSource).toContain('CAPABILITY_PROFILE: _ignoredLocalCapabilityProfile');
		const localValues = viteSource.indexOf('...convexLocalEnv');
		const managedUpdates = viteSource.indexOf('...managedProviderUpdates', localValues);
		const launcherProfile = viteSource.indexOf("CAPABILITY_PROFILE: isTestMode ? 'test' : 'local'");
		expect(localValues).toBeGreaterThan(-1);
		expect(managedUpdates).toBeGreaterThan(localValues);
		expect(launcherProfile).toBeGreaterThan(managedUpdates);
	});

	it('does not inject provider dummies in test mode', () => {
		expect(viteSource).not.toContain('TEST_ONLY_ENV_PLACEHOLDERS');
		expect(viteSource).not.toContain('re_local_e2e_dummy');
		expect(viteSource).not.toContain('am_sk_local_e2e_dummy');
		expect(viteSource).not.toContain('sk-or-local-e2e-dummy');
	});
});
