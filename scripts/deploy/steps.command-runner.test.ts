// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../deploy';
import type {
	CommandExit,
	CommandRunnerDependencies,
	SpawnedCommand,
	SpawnRequest
} from '../process/command-runner';
import {
	defaultReply,
	harness,
	previewEnv,
	productionEnv,
	settledChild,
	SITE
} from './__fixtures__/execution';
import { createDeploymentExecution } from './execution';
import { buildSvelteKit, setupPreviewEnv } from './steps';

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

const deployment = { urlSlug: 'preview-backend', name: 'preview-backend' };
const platform = {
	platform: 'vercel',
	environment: 'preview',
	deployUrl: SITE,
	gitRef: 'current',
	isPreview: true,
	siteUrl: SITE
} as const;

describe('deployment calls use the reviewed runner', () => {
	it('uses inherited build output and removes the Varlock manifest', async () => {
		const h = harness({ __VARLOCK_ENV: 'host-manifest' });
		await buildSvelteKit(
			{ PUBLIC_CONVEX_URL: 'https://preview.convex.cloud', __VARLOCK_ENV: 'manifest' },
			h.execution
		);
		expect(h.spawn).toHaveBeenCalledWith(
			expect.objectContaining({ command: 'bun', args: ['run', 'build'], output: 'inherit' })
		);
		expect(h.spawn.mock.calls[0]?.[0].env).not.toHaveProperty('__VARLOCK_ENV');
	});
	it('executes exactly five SITE_URL attempts and only four delays on exhaustion', async () => {
		const h = harness(previewEnv, (request) =>
			request.args[2] === 'set' ? { exitCode: 1 } : defaultReply(request)
		);
		await expect(setupPreviewEnv(deployment, platform, h.execution)).rejects.toThrow(
			'Failed to set SITE_URL'
		);
		expect(h.spawn).toHaveBeenCalledTimes(5);
		expect(h.sleep).toHaveBeenCalledTimes(4);
		expect(h.events.filter((event) => event === 'wait:5000')).toHaveLength(4);
	});
	it('stops SITE_URL retries at first success', async () => {
		let attempts = 0;
		const h = harness(previewEnv, (request) =>
			request.args[2] === 'set' && ++attempts < 3 ? { exitCode: 1 } : defaultReply(request)
		);
		await setupPreviewEnv(deployment, platform, h.execution);
		expect(attempts).toBe(3);
		expect(h.sleep).toHaveBeenCalledTimes(2);
	});
	it('keeps verification failure and seed failure non-blocking, without printing captures', async () => {
		let lists = 0;
		const h = harness(previewEnv, (request) => {
			if (request.args[2] === 'list' && ++lists === 1)
				return { exitCode: 1, stderr: 'runtime-secret' };
			if (request.args[1] === 'run') return { exitCode: 1, stdout: 'runtime-secret' };
			return defaultReply(request);
		});
		await setupPreviewEnv(deployment, platform, h.execution);
		expect(console.warn).toHaveBeenCalledTimes(2);
		expect(console.error).not.toHaveBeenCalled();
		expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('runtime-secret');
	});
	it('refuses a mismatched SITE_URL and missing deployment/site metadata', async () => {
		const h = harness(previewEnv, (request) =>
			request.args[2] === 'list' ? { stdout: 'SITE_URL=https://wrong.test' } : defaultReply(request)
		);
		await expect(setupPreviewEnv(deployment, platform, h.execution)).rejects.toThrow(
			'SITE_URL mismatch'
		);
		expect(h.spawn).toHaveBeenCalledTimes(2);
		await expect(
			setupPreviewEnv({ urlSlug: null, name: null }, platform, h.execution)
		).rejects.toThrow('deployment name');
		await expect(
			setupPreviewEnv(deployment, { ...platform, siteUrl: null }, h.execution)
		).rejects.toThrow('Site URL');
		expect(h.spawn).toHaveBeenCalledTimes(2);
	});
});

const stages: Array<[string, boolean, (request: SpawnRequest) => boolean]> = [
	['translation', false, (r) => r.command === 'tolgee'],
	['production validation', false, (r) => r.args.includes('--prod')],
	['deployment', true, (r) => r.args[1] === 'deploy'],
	['SITE_URL update', true, (r) => r.args[2] === 'set'],
	['verification', true, (r) => r.args[2] === 'list'],
	['seeding', true, (r) => r.args[1] === 'run'],
	['build', true, (r) => r.command === 'bun']
];

describe.each(['aborted', 'timed_out'] as const)('pipeline %s propagation', (stop) => {
	it.each(stages)(
		'settles the %s child and stops later work',
		async (_stage, isPreview, matches) => {
			const controller = new AbortController();
			let settle!: (exit: CommandExit) => void;
			const child: SpawnedCommand = {
				stdout: null,
				stderr: null,
				exited: new Promise((resolve) => {
					settle = resolve;
				}),
				kill: vi.fn(() => true)
			};
			const spawn = vi.fn((request: SpawnRequest) =>
				matches(request) ? child : settledChild(defaultReply(request))
			);
			const timers = new Set<() => void>();
			const createTimer: CommandRunnerDependencies['createTimer'] = (callback) => {
				timers.add(callback);
				return {
					cancel: () => {
						timers.delete(callback);
					}
				};
			};
			const killProcessTree = vi.fn((_child: SpawnedCommand, signal: NodeJS.Signals) =>
				settle({ exitCode: null, signal })
			);
			const execution = createDeploymentExecution({
				env: isPreview ? previewEnv : productionEnv,
				signal: controller.signal,
				timeoutMs: 25,
				runner: { spawn, createTimer, killProcessTree }
			});
			const writeConfig = vi.fn();
			const pending = main(execution, { writeConfig });
			const rejected = expect(pending).rejects.toMatchObject({ code: stop });
			await vi.waitFor(() => expect(spawn.mock.calls.some(([r]) => matches(r))).toBe(true));
			const callsAtStop = spawn.mock.calls.length;
			if (stop === 'aborted') controller.abort();
			else for (const timer of [...timers]) timer();
			await rejected;
			expect(spawn).toHaveBeenCalledTimes(callsAtStop);
			expect(killProcessTree.mock.calls).toEqual([
				[child, 'SIGTERM'],
				[child, 'SIGKILL']
			]);
			expect(timers.size).toBe(0);
			expect(console.error).not.toHaveBeenCalled();
			expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Deployment complete!'));
		}
	);
	it('does no work for an already-aborted parent', async () => {
		const h = harness(previewEnv, defaultReply, { signal: AbortSignal.abort() });
		await expect(main(h.execution, h.options)).rejects.toMatchObject({ code: 'aborted' });
		expect(h.spawn).not.toHaveBeenCalled();
	});
});
