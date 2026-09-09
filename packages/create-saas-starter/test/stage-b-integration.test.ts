import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');

function read(relative: string): string {
	return readFileSync(path.join(REPOSITORY_ROOT, relative), 'utf8');
}

function triggerPaths(workflow: string, event: 'push' | 'pull_request'): string[] {
	const eventBlock = workflow.split(`  ${event}:\n`)[1]?.split(/\n {2}[a-z_]+:/)[0] ?? '';
	return [...eventBlock.matchAll(/^ {6}- (.+)$/gm)].map((match) => match[1]!);
}

function workflowSteps(workflow: string): string[] {
	return workflow.split(/^ {6}- /m).slice(1);
}

describe('root creator commands', () => {
	it('dispatches every CLI boundary through Bun with an explicit child cwd', () => {
		const manifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

		expect(manifest.scripts).toMatchObject({
			'check:cli': 'bun run --cwd packages/create-saas-starter typecheck',
			'test:cli': 'bun run --cwd packages/create-saas-starter test',
			'build:cli': 'bun run --cwd packages/create-saas-starter build',
			'test:cli:packed': 'bun run --cwd packages/create-saas-starter test:packed'
		});
	});

	it('runs child tests exactly once from the complete root suite', () => {
		const manifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
		const rootTestCommands = manifest.scripts.test.split('&&').map((command) => command.trim());

		expect(rootTestCommands.filter((command) => command === 'bun run test:cli')).toHaveLength(1);
		expect(read('vite.config.ts')).toContain("'packages/create-saas-starter/test/**'");
	});
});

describe('creator workflows', () => {
	it('runs the complete packed consumer on native baseline platforms and pinned current tools', () => {
		const workflow = read('.github/workflows/create-saas-starter.yml');

		for (const os of ['ubuntu-latest', 'macos-latest', 'windows-latest']) {
			expect(workflow).toContain(`os: ${os}`);
		}
		for (const version of ['node: 22.16.0', 'bun: 1.3.9', 'node: 24.19.0', 'bun: 1.3.14']) {
			expect(workflow).toContain(version);
		}
		for (const command of ['typecheck', 'test', 'knip', 'build', 'test:packed']) {
			expect(workflow).toContain(`bun run --cwd packages/create-saas-starter ${command}`);
		}
		expect(workflow).toContain('CREATE_SAAS_STARTER_ARTIFACT_DIR:');
		expect(workflow).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
		expect(workflow).not.toMatch(/\bnpm publish\b|\bbun publish\b/);
	});

	it('generates the root base tsconfig before child tests transform the shared helper', () => {
		const workflow = read('.github/workflows/create-saas-starter.yml');
		const steps = workflowSteps(workflow);
		const commands = [
			'bun install --cwd packages/create-saas-starter --frozen-lockfile',
			'bun install --frozen-lockfile --ignore-scripts',
			'bun svelte-kit sync',
			'bun run --cwd packages/create-saas-starter test'
		];
		const indices = commands.map((command) =>
			steps.findIndex((step) => step.startsWith(`run: ${command}\n`))
		);

		expect(indices.every((index) => index !== -1)).toBe(true);
		expect(indices).toEqual([...indices].sort((left, right) => left - right));
		const syncStep = steps[indices[2]!]!;
		expect([...syncStep.matchAll(/^ {10}([A-Z][A-Z0-9_]+):/gm)].map((match) => match[1])).toEqual([
			'PUBLIC_CONVEX_URL',
			'PUBLIC_CONVEX_SITE_URL'
		]);
		expect(read('tsconfig.json')).toContain('"extends": "./.svelte-kit/tsconfig.json"');
		expect(read('packages/create-saas-starter/tsconfig.json')).toContain(
			'"../../scripts/windows-job.ts"'
		);
		expect(read('packages/create-saas-starter/src/process.ts')).toContain(
			"from '../../../scripts/windows-job.ts'"
		);
	});

	it('triggers child tests when covered external workflows change', () => {
		const creatorWorkflowPath = '.github/workflows/create-saas-starter.yml';
		const integrationTest = read('packages/create-saas-starter/test/stage-b-integration.test.ts');
		const creatorWorkflow = read(creatorWorkflowPath);
		const coveredWorkflowPaths = [
			...integrationTest.matchAll(/read\('(\.github\/workflows\/[^']+\.yml)'\)/g)
		]
			.map((match) => match[1]!)
			.filter((workflowPath) => workflowPath !== creatorWorkflowPath);

		expect(coveredWorkflowPaths.length).toBeGreaterThan(0);
		for (const event of ['push', 'pull_request'] as const) {
			expect(triggerPaths(creatorWorkflow, event)).toEqual(
				expect.arrayContaining(coveredWorkflowPaths)
			);
		}
	});

	it('installs the child lock before static and Windows checks', () => {
		const staticChecks = read('.github/workflows/static-checks.yml');
		const windowsLifecycle = read('.github/workflows/windows-process-lifecycle.yml');

		expect(staticChecks.match(/run: bun install --frozen-lockfile/g)).toHaveLength(4);
		expect(staticChecks).not.toMatch(/run: bun install\s*$/m);
		expect(windowsLifecycle).toContain('packages/create-saas-starter/.*');
		expect(windowsLifecycle).toContain(
			'run: bun install --cwd packages/create-saas-starter --frozen-lockfile --ignore-scripts'
		);
		expect(windowsLifecycle).toContain(
			'run: bun run --cwd packages/create-saas-starter vitest --run test/process.test.ts test/lifecycle.test.ts'
		);
	});
});
