import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandFailure, CommandSuccess } from '../process/command-runner';
import type { PlatformContext } from './platform';

const runnerMocks = vi.hoisted(() => ({
	runCommand: vi.fn(),
	runCommandWithRetry: vi.fn()
}));

const utilityMocks = vi.hoisted(() => ({
	runCommandCapture: vi.fn()
}));

vi.mock('../process/command-runner', () => runnerMocks);
vi.mock('./utils', () => ({
	colors: { reset: '', green: '', yellow: '', red: '' },
	runCommandCapture: utilityMocks.runCommandCapture,
	sleep: vi.fn(async () => undefined),
	stripAnsi: (value: string) => value
}));

import {
	buildSvelteKit,
	setupPreviewEnv,
	syncTranslations,
	validateConvexEnv,
	type ConvexDeployment
} from './steps';

const commandSuccess: CommandSuccess = {
	ok: true,
	exitCode: 0,
	description: 'command',
	stdout: '',
	stderr: '',
	diagnostic: 'command: exited with code 0'
};

const commandFailure: CommandFailure = {
	ok: false,
	kind: 'non_zero_exit',
	exitCode: 1,
	description: 'command',
	stdout: '',
	stderr: 'failed',
	diagnostic: 'command: exited with code 1\nstderr:\nfailed'
};

function makePlatform(overrides: Partial<PlatformContext> = {}): PlatformContext {
	return {
		platform: 'cloudflare',
		environment: 'production',
		deployUrl: null,
		gitRef: 'main',
		isPreview: false,
		siteUrl: 'https://app.example.com',
		...overrides
	};
}

const deployment: ConvexDeployment = {
	urlSlug: 'preview-name.eu-west-1',
	name: 'preview-name'
};

describe('deployment command-runner migration', () => {
	const originalTolgeeApiKey = process.env.TOLGEE_API_KEY;

	beforeEach(() => {
		runnerMocks.runCommand.mockReset().mockResolvedValue(commandSuccess);
		runnerMocks.runCommandWithRetry.mockReset().mockResolvedValue({
			result: commandSuccess,
			attempts: 1
		});
		utilityMocks.runCommandCapture.mockReset();
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => {
		if (originalTolgeeApiKey === undefined) delete process.env.TOLGEE_API_KEY;
		else process.env.TOLGEE_API_KEY = originalTolgeeApiKey;
		vi.restoreAllMocks();
	});

	it('runs translation commands through inherited-output specs in order', async () => {
		process.env.TOLGEE_API_KEY = 'configured';

		await syncTranslations(makePlatform());

		expect(runnerMocks.runCommand.mock.calls).toEqual([
			[
				{
					command: 'tolgee',
					args: ['tag', '--filter-extracted', '--tag', 'production', '--untag', 'preview'],
					output: 'inherit'
				}
			],
			[
				{
					command: 'tolgee',
					args: ['pull'],
					output: 'inherit'
				}
			]
		]);
	});

	it('runs preview environment validation through the shared runner', async () => {
		await validateConvexEnv(
			makePlatform({ environment: 'preview', isPreview: true, gitRef: 'feature/test' }),
			deployment
		);

		expect(runnerMocks.runCommand).toHaveBeenCalledWith({
			command: 'bun',
			args: ['scripts/validate-convex-env.ts', '--deployment-name', 'preview-name'],
			output: 'inherit'
		});
	});

	it('builds with inherited output and explicitly removes the injected Varlock manifest', async () => {
		await buildSvelteKit({
			PUBLIC_CONVEX_URL: 'https://preview.convex.cloud',
			__VARLOCK_ENV: 'must-not-survive'
		});

		expect(runnerMocks.runCommand).toHaveBeenCalledWith({
			command: 'bun',
			args: ['run', 'build'],
			env: {
				PUBLIC_CONVEX_URL: 'https://preview.convex.cloud',
				__VARLOCK_ENV: undefined
			},
			output: 'inherit'
		});
	});

	it('declares exactly five SITE_URL attempts through the retry primitive', async () => {
		runnerMocks.runCommand
			.mockResolvedValueOnce({
				...commandSuccess,
				stdout: 'SITE_URL=https://preview.example.com\n'
			})
			.mockResolvedValueOnce(commandSuccess);
		utilityMocks.runCommandCapture.mockReturnValueOnce({
			success: true,
			stdout: 'seeded',
			stderr: ''
		});

		await setupPreviewEnv(
			deployment,
			makePlatform({
				environment: 'preview',
				isPreview: true,
				gitRef: 'feature/test',
				siteUrl: 'https://preview.example.com'
			})
		);

		expect(runnerMocks.runCommandWithRetry).toHaveBeenCalledTimes(1);
		const [spec, options] = runnerMocks.runCommandWithRetry.mock.calls[0] ?? [];
		expect(spec).toEqual({
			command: 'bunx',
			args: [
				'convex',
				'env',
				'set',
				'--deployment-name',
				'preview-name',
				'SITE_URL',
				'https://preview.example.com'
			]
		});
		expect(options).toMatchObject({
			maxAttempts: 5,
			delay: { kind: 'fixed', delayMs: 5000 }
		});
		expect(options?.shouldRetry(commandFailure, 1)).toBe(true);
		expect(runnerMocks.runCommand.mock.calls).toEqual([
			[
				{
					command: 'bunx',
					args: ['convex', 'env', 'list', '--deployment-name', 'preview-name'],
					output: 'capture'
				}
			],
			[
				{
					command: 'bun',
					args: ['scripts/validate-convex-env.ts', '--deployment-name', 'preview-name'],
					output: 'inherit'
				}
			]
		]);
	});
});
