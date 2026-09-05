// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main, runDeploymentCli } from '../deploy';
import {
	defaultReply,
	harness,
	previewEnv,
	productionEnv,
	quotaEnv,
	quotaFailure,
	SITE
} from './__fixtures__/execution';
import { withCliSignals } from './cli';
import { DeploymentError } from './execution';

beforeEach(() => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => {
			throw new Error('Unexpected network in deployment test');
		})
	);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('deployment pipeline', () => {
	it('preserves the entire production step order', async () => {
		const h = harness();
		await main(h.execution, h.options);
		expect(h.events).toEqual([
			'tolgee tag --filter-extracted --tag production --untag preview',
			'tolgee pull',
			'bunx convex env list --prod',
			'bunx convex deploy',
			'config',
			'bun run build'
		]);
		expect(h.writeConfig).toHaveBeenCalledWith(
			expect.objectContaining({ isPreview: false }),
			expect.objectContaining({
				PUBLIC_CONVEX_URL: 'https://preview-backend.eu-west-1.convex.cloud',
				PUBLIC_SITE_URL: productionEnv.SITE_URL
			})
		);
		expect(h.remove).not.toHaveBeenCalled();
	});
	it('preserves the entire preview step order, URLs, key selection and build secret stripping', async () => {
		const hostKey = process.env.CONVEX_DEPLOY_KEY;
		const h = harness({
			...previewEnv,
			CONVEX_DEPLOY_KEY: 'production-key',
			__VARLOCK_ENV: 'injected-manifest'
		});
		await main(h.execution, h.options);
		expect(h.events).toEqual([
			'tolgee tag --filter-extracted --tag preview',
			'tolgee pull',
			'bunx convex deploy --preview-create current',
			`bunx convex env set --deployment-name preview-backend SITE_URL ${SITE}`,
			'bunx convex env list --deployment-name preview-backend',
			'bunx convex env list --deployment-name preview-backend',
			'bunx convex run --deployment-name preview-backend previewDev:ensurePreviewAdmin',
			'config',
			'bun run build'
		]);
		const requests = h.spawn.mock.calls.map(([request]) => request);
		const build = requests.at(-1);
		expect(build?.env).toMatchObject({
			CONVEX_DEPLOY_KEY: 'preview-key',
			SITE_URL: SITE,
			PUBLIC_SITE_URL: SITE
		});
		expect(build?.env).not.toHaveProperty('__VARLOCK_ENV');
		expect(
			requests
				.filter((request) => request.args[0] === 'convex')
				.every((request) => request.env.CONVEX_DEPLOY_KEY === 'preview-key')
		).toBe(true);
		expect(process.env.CONVEX_DEPLOY_KEY).toBe(hostKey);
		expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('runtime-secret');
	});
	it('preserves development/unknown-platform branching and optional translation sync', async () => {
		const development = harness({
			VERCEL: '1',
			VERCEL_ENV: 'development',
			TOLGEE_API_KEY: 'configured'
		});
		await main(development.execution, development.options);
		expect(development.events).toEqual([
			'tolgee pull',
			'bunx convex deploy',
			'config',
			'bun run build'
		]);
		const unknown = harness({});
		await main(unknown.execution, unknown.options);
		expect(unknown.events).toEqual([
			'bunx convex env list --prod',
			'bunx convex deploy',
			'config',
			'bun run build'
		]);
	});
	it('refuses a production deploy key on a preview before deploying', async () => {
		const h = harness({
			...previewEnv,
			CONVEX_PREVIEW_DEPLOY_KEY: undefined,
			CONVEX_DEPLOY_KEY: 'production-key'
		});
		await expect(main(h.execution, h.options)).rejects.toMatchObject({ code: 'configuration' });
		expect(h.events).toEqual(['tolgee tag --filter-extracted --tag preview', 'tolgee pull']);
		expect(console.error).not.toHaveBeenCalled();
	});
	it('propagates helper failures without logging or starting later steps', async () => {
		const h = harness(productionEnv, () => ({ exitCode: 7, stderr: 'provider-secret' }));
		await expect(main(h.execution, h.options)).rejects.toBeInstanceOf(DeploymentError);
		expect(h.spawn).toHaveBeenCalledTimes(1);
		expect(console.error).not.toHaveBeenCalled();
	});
	it('reports once and sets the failure exit code at the entry boundary', async () => {
		const saved = process.exitCode;
		try {
			process.exitCode = undefined;
			const h = harness(productionEnv, () => ({ exitCode: 9, stderr: 'provider-secret' }));
			await runDeploymentCli(h.execution, h.options);
			expect(process.exitCode).toBe(1);
			expect(console.error).toHaveBeenCalledTimes(1);
			expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Tolgee tagging failed'));
			expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('provider-secret');
		} finally {
			process.exitCode = saved;
		}
	});
	it('leaves the successful CLI exit code unset and does not report an error', async () => {
		const saved = process.exitCode;
		try {
			process.exitCode = undefined;
			const h = harness();
			await runDeploymentCli(h.execution, h.options);
			expect(process.exitCode).toBeUndefined();
			expect(console.error).not.toHaveBeenCalled();
		} finally {
			process.exitCode = saved;
		}
	});
	it('releases signal handlers on both success and failure', async () => {
		const before = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };
		await withCliSignals(async (signal) => {
			expect(signal.aborted).toBe(false);
			expect(process.listenerCount('SIGTERM')).toBe(before.term + 1);
			const ownListener = process.listeners('SIGTERM').at(-1);
			ownListener?.('SIGTERM');
			expect(signal.aborted).toBe(true);
		});
		await expect(
			withCliSignals(async () => {
				throw new Error('fixture');
			})
		).rejects.toThrow('fixture');
		expect(process.listenerCount('SIGINT')).toBe(before.int);
		expect(process.listenerCount('SIGTERM')).toBe(before.term);
	});
});

describe('quota recovery through the real exact-attempt runner', () => {
	it('prunes once, waits for propagation, then retries successfully', async () => {
		let attempts = 0;
		const h = harness(quotaEnv, (request) =>
			request.args[1] === 'deploy' && ++attempts === 1 ? quotaFailure : defaultReply(request)
		);
		await main(h.execution, h.options);
		expect(attempts).toBe(2);
		expect(h.remove).toHaveBeenCalledExactlyOnceWith(
			'management-secret',
			'old-1',
			expect.objectContaining({ timeoutMs: 900_000 })
		);
		const first = h.events.indexOf('bunx convex deploy --preview-create current');
		expect(h.events.slice(first, first + 6)).toEqual([
			'bunx convex deploy --preview-create current',
			'git ls-remote --heads origin',
			'list-previews',
			'delete:old-1',
			'wait:10000',
			'bunx convex deploy --preview-create current'
		]);
	});
	it('exhausts exactly four total deployments and three individual deletions/delays', async () => {
		const h = harness(quotaEnv, (request) =>
			request.args[1] === 'deploy' ? quotaFailure : defaultReply(request)
		);
		await expect(main(h.execution, h.options)).rejects.toThrow('Convex deployment failed');
		expect(
			h.events.filter((event) => event === 'bunx convex deploy --preview-create current')
		).toHaveLength(4);
		expect(h.list).toHaveBeenCalledTimes(3);
		expect(h.remove.mock.calls.map(([, name]) => name)).toEqual(['old-1', 'old-2', 'old-3']);
		expect(h.sleep).toHaveBeenCalledTimes(3);
		expect(h.events.filter((event) => event === 'git ls-remote --heads origin')).toHaveLength(3);
		expect(h.writeConfig).not.toHaveBeenCalled();
	});
	it('stops immediately on a non-quota propagation retry failure', async () => {
		let attempts = 0;
		const h = harness(quotaEnv, (request) =>
			request.args[1] === 'deploy'
				? ++attempts === 1
					? quotaFailure
					: { exitCode: 1, stderr: 'different failure' }
				: defaultReply(request)
		);
		await expect(main(h.execution, h.options)).rejects.toThrow('Convex deployment failed');
		expect(attempts).toBe(2);
		expect(h.remove).toHaveBeenCalledTimes(1);
		expect(h.sleep).toHaveBeenCalledTimes(1);
	});
	it.each(['production', 'missing-credentials', 'non-quota'] as const)(
		'does not recover %s failures',
		async (scenario) => {
			const env =
				scenario === 'production'
					? { ...quotaEnv, ...productionEnv, VERCEL: undefined }
					: scenario === 'missing-credentials'
						? previewEnv
						: quotaEnv;
			const h = harness(env, (request) =>
				request.args[1] === 'deploy'
					? scenario === 'non-quota'
						? { exitCode: 1, stderr: 'not quota' }
						: quotaFailure
					: defaultReply(request)
			);
			await expect(main(h.execution, h.options)).rejects.toThrow('Convex deployment failed');
			expect(h.events.filter((event) => event.startsWith('bunx convex deploy'))).toHaveLength(1);
			expect(h.remove).not.toHaveBeenCalled();
			expect(h.sleep).not.toHaveBeenCalled();
		}
	);
	it.each([{ exitCode: 1 }, { stdout: 'unparseable remote output' }])(
		'refuses to prune with an unknown live-branch snapshot: %j',
		async (remote) => {
			const h = harness(quotaEnv, (request) =>
				request.command === 'git'
					? remote
					: request.args[1] === 'deploy'
						? quotaFailure
						: defaultReply(request)
			);
			await expect(main(h.execution, h.options)).rejects.toMatchObject({ code: 'prune_blocked' });
			expect(h.remove).not.toHaveBeenCalled();
			expect(h.list).not.toHaveBeenCalled();
		}
	);
	it('never deletes when every candidate is live or explicitly protected', async () => {
		const h = harness(quotaEnv, (request) =>
			request.command === 'git'
				? { stdout: 'a'.repeat(40) + '\trefs/heads/closed-1\n' }
				: request.args[1] === 'deploy'
					? quotaFailure
					: defaultReply(request)
		);
		await expect(
			main(h.execution, {
				...h.options,
				recovery: { ...h.options.recovery, protectedDeployments: new Set(['old-2', 'old-3']) }
			})
		).rejects.toMatchObject({ code: 'prune_blocked' });
		expect(h.remove).not.toHaveBeenCalled();
	});
	it.each(['list', 'remove'] as const)(
		'does not repeat a failed %s operation',
		async (operation) => {
			const h = harness(quotaEnv, (request) =>
				request.args[1] === 'deploy' ? quotaFailure : defaultReply(request)
			);
			h[operation].mockRejectedValue(new DeploymentError('request_failed', 'management failed'));
			await expect(main(h.execution, h.options)).rejects.toThrow('management failed');
			expect(h[operation]).toHaveBeenCalledTimes(1);
			expect(h.sleep).not.toHaveBeenCalled();
			expect(h.events.filter((event) => event.startsWith('bunx convex deploy'))).toHaveLength(1);
		}
	);
	it('does not delete after cancellation during listing', async () => {
		const controller = new AbortController();
		const h = harness(
			quotaEnv,
			(request) => (request.args[1] === 'deploy' ? quotaFailure : defaultReply(request)),
			{ signal: controller.signal }
		);
		const originalList = h.list.getMockImplementation();
		h.list.mockImplementation(async () => {
			const previews = await originalList!();
			controller.abort();
			return previews;
		});
		await expect(main(h.execution, h.options)).rejects.toMatchObject({ code: 'aborted' });
		expect(h.remove).not.toHaveBeenCalled();
	});
	it('settles an aborted propagation delay without another deploy or deletion', async () => {
		const controller = new AbortController();
		const h = harness(
			quotaEnv,
			(request) => (request.args[1] === 'deploy' ? quotaFailure : defaultReply(request)),
			{ signal: controller.signal }
		);
		h.sleep.mockImplementation(async () => {
			controller.abort();
			const error = new Error('aborted');
			error.name = 'AbortError';
			throw error;
		});
		await expect(main(h.execution, h.options)).rejects.toMatchObject({ code: 'aborted' });
		expect(h.remove).toHaveBeenCalledTimes(1);
		expect(h.events.filter((event) => event.startsWith('bunx convex deploy'))).toHaveLength(1);
	});
});
