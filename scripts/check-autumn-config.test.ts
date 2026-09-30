import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import catalog from '../autumn.config';
import { testExecutable } from './test-executable';

describe('Autumn CLI 2 catalog', () => {
	it('preserves the sandbox plan versions, active pointers and monthly allowances', () => {
		expect(catalog.features).toEqual([
			{ feature_id: 'messages', name: 'Messages', type: 'metered', consumable: true },
			{
				feature_id: 'ai_chat_messages',
				name: 'AI Chat Messages',
				type: 'metered',
				consumable: true
			}
		]);
		expect(catalog.plans).toEqual([
			{
				plan_id: 'free',
				name: 'Free',
				version_slug: 'v1',
				active: false,
				auto_enable: false,
				items: [{ feature_id: 'messages', included: 3, reset: { interval: 'month' } }]
			},
			{
				plan_id: 'free',
				name: 'Free',
				version_slug: 'v2',
				active: true,
				auto_enable: true,
				items: [
					{ feature_id: 'messages', included: 3, reset: { interval: 'month' } },
					{ feature_id: 'ai_chat_messages', included: 3, reset: { interval: 'month' } }
				]
			},
			{
				plan_id: 'pro',
				name: 'Pro',
				version_slug: 'v1',
				active: true,
				auto_enable: false,
				price: { amount: 10, interval: 'month' },
				items: [
					{ feature_id: 'messages', unlimited: true, reset: { interval: 'month' } },
					{ feature_id: 'ai_chat_messages', included: 30, reset: { interval: 'month' } }
				]
			}
		]);
	});

	it('leaves dashboard-managed collections and processor associations unchanged', () => {
		for (const key of ['rewards', 'referral_programs', 'settings', 'webhooks']) {
			expect(catalog).not.toHaveProperty(key);
		}
		// Processor fields are omitted from every feature, plan and price above.
		// CLI 2's public constructor retains its own complete-catalog semantics.
		expect(catalog.skip_deletions).toBe(false);
		expect(catalog.skip_version_deletions).toBe(false);
		expect(catalog.migration).toEqual({ draft: true });
	});

	it('validates without credentials, network access or child processes', () => {
		const script = new URL('./check-autumn-config.ts', import.meta.url).href;
		const result = spawnSync(
			testExecutable('bun'),
			[
				'--eval',
				`
				const deny = () => { throw new Error('Offline validation must not contact Autumn or run a CLI'); };
				globalThis.fetch = deny;
				Bun.spawn = deny;
				Bun.spawnSync = deny;
				const childProcess = await import('node:child_process');
				for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) childProcess.default[key] = deny;
				for (const name of ['node:http', 'node:https']) {
					const module = await import(name);
					module.default.request = deny;
					module.default.get = deny;
				}
				await import(${JSON.stringify(script)});
				console.log('Offline validation passed');
				`
			],
			{
				cwd: fileURLToPath(new URL('..', import.meta.url)),
				encoding: 'utf8',
				env: { ...process.env, AUTUMN_SECRET_KEY: '', AUTUMN_PROD_SECRET_KEY: '' },
				timeout: 15_000
			}
		);
		expect(result.stderr).toBe('');
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Offline validation passed');
	});

	it('rejects a plan referencing a feature missing from the catalog', () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'autumn-config-'));
		try {
			mkdirSync(path.join(directory, 'scripts'));
			copyFileSync(
				fileURLToPath(new URL('./check-autumn-config.ts', import.meta.url)),
				path.join(directory, 'scripts/check-autumn-config.ts')
			);
			writeFileSync(
				path.join(directory, 'autumn.config.ts'),
				`import { atmn, plan } from ${JSON.stringify(import.meta.resolve('atmn'))};
				export default atmn({
					features: [],
					plans: [plan({ planId: 'free', name: 'Free', active: true,
						items: [{ featureId: 'missing', included: 3, reset: { interval: 'month' } }] })]
				});`
			);
			const result = spawnSync(testExecutable('bun'), ['scripts/check-autumn-config.ts'], {
				cwd: directory,
				encoding: 'utf8',
				env: { ...process.env, AUTUMN_SECRET_KEY: '', AUTUMN_PROD_SECRET_KEY: '' },
				timeout: 15_000
			});
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain('missing');
			expect(result.stdout).not.toContain('Autumn config validated locally');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
