// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main as upload, runCloudflareDeployCli } from '../cf-deploy';
import { main as publish, runCloudflareProductionCli } from '../cf-prod-deploy';
import { getRequiredVarNames, main as validate } from '../validate-convex-env';
import { main as deletePreview } from './delete-preview';
import { defaultReply, harness, quotaEnv } from './__fixtures__/execution';

beforeEach(() => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => {
			throw new Error('unexpected real HTTP');
		})
	);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('Cloudflare deployment entries', () => {
	it('uploads preview aliases through varlock-wrangler and preserves its runtime environment', async () => {
		const h = harness({
			WORKERS_CI_BRANCH: '123-feature',
			WORKERS_NAME: 'worker',
			__VARLOCK_ENV: 'runtime-values'
		});
		await upload(h.execution);
		expect(h.spawn).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				command: 'bunx',
				args: ['varlock-wrangler', 'versions', 'upload', '--preview-alias', 'b-123-feature'],
				output: 'inherit',
				env: expect.objectContaining({ __VARLOCK_ENV: 'runtime-values' })
			})
		);
		expect(fetch).not.toHaveBeenCalled();
	});
	it('uploads production without an alias and rejects missing preview worker names before any process', async () => {
		const h = harness({ WORKERS_CI_BRANCH: 'main' });
		await upload(h.execution);
		expect(h.events).toEqual(['bunx varlock-wrangler versions upload']);
		const invalid = harness({ WORKERS_CI_BRANCH: 'feature' });
		await expect(upload(invalid.execution)).rejects.toMatchObject({ code: 'configuration' });
		expect(invalid.spawn).not.toHaveBeenCalled();
	});
	for (const entry of [runCloudflareDeployCli, runCloudflareProductionCli]) {
		it(`${entry.name} preserves child failure status and reports exactly once`, async () => {
			const saved = process.exitCode ?? 0;
			try {
				process.exitCode = 0;
				const h = harness({}, () => ({ exitCode: 7, stderr: 'runtime-secret' }));
				await entry(h.execution);
				expect(process.exitCode).toBe(7);
				expect(console.error).toHaveBeenCalledTimes(1);
				expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('runtime-secret'));
				expect(fetch).not.toHaveBeenCalled();
			} finally {
				process.exitCode = saved;
			}
		});
		it(`${entry.name} keeps success at zero and abort nonzero`, async () => {
			const saved = process.exitCode ?? 0;
			try {
				process.exitCode = 0;
				await entry(harness({}).execution);
				expect(process.exitCode).toBe(0);
				const controller = new AbortController();
				controller.abort();
				const h = harness({}, defaultReply, { signal: controller.signal });
				await entry(h.execution);
				expect(process.exitCode).toBe(1);
				expect(h.spawn).not.toHaveBeenCalled();
			} finally {
				process.exitCode = saved;
			}
		});
	}
	it('does not purge without credentials, but purges after successful publication when configured', async () => {
		const skipped = harness({});
		await publish(skipped.execution);
		expect(fetch).not.toHaveBeenCalled();
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: true })));
		const h = harness({ CF_PURGE_TOKEN: 'purge-secret', CF_ZONE_ID: 'zone' });
		await publish(h.execution);
		expect(h.events).toEqual(['bunx varlock-wrangler deploy']);
		expect(fetch).toHaveBeenCalledExactlyOnceWith(
			'https://api.cloudflare.com/client/v4/zones/zone/purge_cache',
			expect.objectContaining({ method: 'POST', body: JSON.stringify({ purge_everything: true }) })
		);
	});
	it('keeps purge failures non-blocking without printing provider bodies or errors', async () => {
		const h = harness({ CF_PURGE_TOKEN: 'purge-secret', CF_ZONE_ID: 'zone' });
		vi.mocked(fetch).mockRejectedValueOnce(new Error('purge-secret'));
		await expect(publish(h.execution)).resolves.toBeUndefined();
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(JSON.stringify({ success: false, errors: 'purge-secret' }))
		);
		await expect(publish(h.execution)).resolves.toBeUndefined();
		expect(console.warn).toHaveBeenCalledTimes(2);
		expect(console.error).not.toHaveBeenCalled();
		for (const call of vi.mocked(console.warn).mock.calls)
			expect(call.join(' ')).not.toContain('purge-secret');
	});
});

describe('reusable Convex validation and close-preview entry', () => {
	it('derives required values from the schema, including reset after optional blocks', () => {
		expect(getRequiredVarNames('# ---\nREQUIRED=\n\n# @optional\nOPTIONAL=\n\nNEXT=')).toEqual([
			'REQUIRED',
			'NEXT'
		]);
		expect(() => getRequiredVarNames('NO_SEPARATOR=')).toThrow('header separator');
	});
	for (const [args, selection] of [
		[[], []],
		[['--prod'], ['--prod']],
		[
			['--preview-name', 'branch'],
			['--preview-name', 'branch']
		],
		[
			['--prod', '--deployment-name', 'name'],
			['--deployment-name', 'name']
		]
	]) {
		it(`routes validation flags ${args?.join(' ')} through the shared runner`, async () => {
			const h = harness({});
			await validate(args, h.execution);
			expect(h.spawn).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({
					args: ['convex', 'env', 'list', ...(selection ?? [])],
					output: 'capture'
				})
			);
		});
	}
	it.each([
		['stdout', 'ViewEnvironmentVariables'],
		['stderr', '\x1b[31mViewEnvironmentVariables\x1b[0m'],
		['stdout', 'deployment:env:view'],
		['stderr', '\x1b[31mdeployment:env:view\x1b[0m']
	] as const)('skips the known Convex env permission marker from %s', async (stream, marker) => {
		const denied = harness({}, () => ({ exitCode: 1, [stream]: `${marker} forbidden secret` }));

		await expect(validate([], denied.execution)).resolves.toBeUndefined();
		expect(console.warn).toHaveBeenCalledTimes(1);
		expect(vi.mocked(console.warn).mock.calls[0]?.join(' ')).not.toContain('forbidden secret');
	});
	it.each(['do not have permission', 'deployment:data:view'])(
		'fails closed for unrelated permission text: %s',
		async (marker) => {
			const denied = harness({}, () => ({ exitCode: 1, stderr: marker }));

			await expect(validate([], denied.execution)).rejects.toMatchObject({
				code: 'command_failed'
			});
			expect(console.warn).not.toHaveBeenCalled();
		}
	);
	it.each(['aborted', 'timed_out'] as const)('fails closed for %s env listing', async (kind) => {
		const execution = {
			run: vi.fn(async () => ({
				ok: false,
				kind,
				description: 'bunx convex env list',
				stdout: 'ViewEnvironmentVariables secret',
				stderr: '',
				diagnostic: 'redacted'
			}))
		} as unknown as NonNullable<Parameters<typeof validate>[1]>;

		await expect(validate([], execution)).rejects.toMatchObject({ code: kind });
		expect(console.warn).not.toHaveBeenCalled();
	});
	it('rejects missing configuration with no fatal helper logging', async () => {
		const missing = harness({}, () => ({ stdout: 'UNUSED=secret' }));
		await expect(validate([], missing.execution)).rejects.toMatchObject({ code: 'configuration' });
		expect(console.error).not.toHaveBeenCalled();
	});
	it('does not list or delete for missing arguments or absent management credentials', async () => {
		const h = harness({});
		await expect(
			deletePreview([], h.execution, h.options.recovery.management)
		).rejects.toMatchObject({ code: 'configuration' });
		await expect(
			deletePreview(['--branch', 'current'], h.execution, h.options.recovery.management)
		).resolves.toBeUndefined();
		expect(h.list).not.toHaveBeenCalled();
		expect(h.remove).not.toHaveBeenCalled();
	});
	it('keeps exact-branch deletion and already-deleted handling idempotent', async () => {
		const h = harness(quotaEnv);
		await deletePreview(['--branch', 'closed-1'], h.execution, h.options.recovery.management);
		await deletePreview(['--branch', 'closed-1'], h.execution, h.options.recovery.management);
		expect(h.remove).toHaveBeenCalledTimes(1);
		expect(h.remove).toHaveBeenCalledWith('management-secret', 'old-1', h.execution);
		expect(fetch).not.toHaveBeenCalled();
	});
});
