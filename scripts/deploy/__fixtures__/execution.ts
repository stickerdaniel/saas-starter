import { vi } from 'vitest';
import type {
	CommandRunnerDependencies,
	SpawnedCommand,
	SpawnRequest
} from '../../process/command-runner';
import { getRequiredVarNames } from '../../validate-convex-env';
import { createDeploymentExecution, type ExecutionControls } from '../execution';
import type { Preview } from '../prune-previews';

export const SITE = 'https://preview.example.test';
export const NOW = 1_700_000_000_000;
export const productionEnv = {
	WORKERS_CI: '1',
	WORKERS_CI_BRANCH: 'main',
	SITE_URL: 'https://production.example.test',
	TOLGEE_API_KEY: 'tolgee-secret'
};
export const previewEnv = {
	VERCEL: '1',
	VERCEL_ENV: 'preview',
	VERCEL_URL: 'preview.example.test',
	VERCEL_GIT_COMMIT_REF: 'current',
	CONVEX_PREVIEW_DEPLOY_KEY: 'preview-key',
	TOLGEE_API_KEY: 'tolgee-secret'
};
export const quotaEnv = {
	...previewEnv,
	CONVEX_MANAGEMENT_TOKEN: 'management-secret',
	CONVEX_PROJECT_ID: 'project'
};
export const quotaFailure = { exitCode: 1, stderr: '\x1b[31mDeploymentQuotaReached\x1b[0m' };

export interface Reply {
	exitCode?: number;
	stdout?: string;
	stderr?: string;
}

export function commandLabel(request: SpawnRequest): string {
	return [request.command, ...request.args].join(' ');
}

export function defaultReply(request: SpawnRequest): Reply {
	if (request.args[0] === 'convex' && request.args[1] === 'deploy') {
		return { stdout: 'Deployed https://preview-backend.eu-west-1.convex.cloud' };
	}
	if (request.args[0] === 'convex' && request.args.includes('list')) {
		return {
			stdout:
				getRequiredVarNames()
					.map((name) => `${name}=${name === 'SITE_URL' ? SITE : 'runtime-secret'}`)
					.join('\n') + `\nSITE_URL=${SITE}`
		};
	}
	if (request.command === 'git') return { stdout: 'a'.repeat(40) + '\trefs/heads/current\n' };
	return {};
}

export function settledChild(reply: Reply = {}): SpawnedCommand {
	const stream = async function* (text: string) {
		yield text;
	};
	return {
		stdout: stream(reply.stdout ?? ''),
		stderr: stream(reply.stderr ?? ''),
		exited: Promise.resolve({ exitCode: reply.exitCode ?? 0, signal: null }),
		kill: vi.fn(() => true)
	};
}

/** Every process is injected. Unexpected HTTP is also rejected by each test's setup. */
export function harness(
	env: NodeJS.ProcessEnv = productionEnv,
	respond: (request: SpawnRequest) => Reply = defaultReply,
	controls: ExecutionControls = {},
	runner: Partial<CommandRunnerDependencies> = {}
) {
	const events: string[] = [];
	const spawn = vi.fn((request: SpawnRequest) => {
		events.push(commandLabel(request));
		return settledChild(respond(request));
	});
	const sleep = vi.fn(async (ms: number) => {
		events.push(`wait:${ms}`);
	});
	const execution = createDeploymentExecution({
		env,
		...controls,
		runner: { spawn, sleep, ...runner }
	});
	const writeConfig = vi.fn(() => {
		events.push('config');
	});
	let previews: Preview[] = [
		{
			name: 'old-1',
			previewIdentifier: 'closed-1',
			createTime: NOW - 900_000,
			expiresAt: null,
			deploymentType: 'preview'
		},
		{
			name: 'old-2',
			previewIdentifier: 'closed-2',
			createTime: NOW - 800_000,
			expiresAt: null,
			deploymentType: 'preview'
		},
		{
			name: 'old-3',
			previewIdentifier: 'closed-3',
			createTime: NOW - 700_000,
			expiresAt: null,
			deploymentType: 'preview'
		},
		{
			name: 'current',
			previewIdentifier: 'current',
			createTime: NOW - 1000,
			expiresAt: null,
			deploymentType: 'preview'
		}
	];
	const list = vi.fn(async () => {
		events.push('list-previews');
		return previews;
	});
	const remove = vi.fn(async (_token: string, name: string) => {
		events.push(`delete:${name}`);
		previews = previews.filter((preview) => preview.name !== name);
	});
	const options = { writeConfig, recovery: { management: { list, remove }, now: () => NOW } };
	return { execution, events, spawn, sleep, writeConfig, list, remove, options };
}
