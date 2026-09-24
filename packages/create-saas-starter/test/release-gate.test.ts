import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');
const PACKAGE_PATH = 'packages/create-saas-starter';
const PACKAGE_ROOT = path.join(REPOSITORY_ROOT, PACKAGE_PATH);
const SOURCE_MANIFEST_TEXT = readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8');
const SOURCE_MANIFEST = JSON.parse(SOURCE_MANIFEST_TEXT) as Record<string, unknown> & {
	version: string;
};
const SOURCE_OPTIONS = readFileSync(path.join(PACKAGE_ROOT, 'src/options.ts'), 'utf8');
const TEMPLATE_PIN = /^export const DEFAULT_TEMPLATE_SHA = '[0-9a-f]{40}';$/m;

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
});

function gateScript(): string {
	const workflow = parseYaml(
		readFileSync(path.join(REPOSITORY_ROOT, '.github/workflows/create-saas-starter.yml'), 'utf8')
	) as { jobs: Record<string, { steps: Array<{ id?: string; run?: string }> }> };
	const run = workflow.jobs['release-gate']!.steps.find((step) => step.id === 'gate')?.run;
	expect(run).toBeDefined();
	return run!;
}

// Git and the gate run without the user's Git configuration or an outer
// repository's GIT_* variables, with a fixed identity.
function isolatedEnvironment(home: string, binDir: string): NodeJS.ProcessEnv {
	const environment = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
	);
	return {
		...environment,
		HOME: home,
		PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
		GIT_CONFIG_GLOBAL: devNull,
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_AUTHOR_NAME: 'Release Gate Test',
		GIT_AUTHOR_EMAIL: 'release-gate@example.invalid',
		GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
		GIT_COMMITTER_NAME: 'Release Gate Test',
		GIT_COMMITTER_EMAIL: 'release-gate@example.invalid',
		GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z'
	};
}

// A shallow CI checkout lacks the real pin's history, so the gate runs in a
// temporary repository whose pin is an ancestor of HEAD.
async function createCheckout(checkout: string, environment: NodeJS.ProcessEnv) {
	const git = (...args: string[]) => {
		const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
			cwd: checkout,
			encoding: 'utf8',
			env: environment
		});
		expect(result.status, result.stdout + result.stderr).toBe(0);
		return result.stdout.trim();
	};
	const optionsPath = path.join(checkout, PACKAGE_PATH, 'src/options.ts');
	await mkdir(path.dirname(optionsPath), { recursive: true });
	await writeFile(path.join(checkout, PACKAGE_PATH, 'package.json'), SOURCE_MANIFEST_TEXT);
	await writeFile(optionsPath, SOURCE_OPTIONS);
	git('init', '-q');
	git('add', '.');
	git('commit', '-q', '-m', 'Template');
	const templateSha = git('rev-parse', 'HEAD');
	const pinnedOptions = SOURCE_OPTIONS.replace(
		TEMPLATE_PIN,
		`export const DEFAULT_TEMPLATE_SHA = '${templateSha}';`
	);
	expect(pinnedOptions).not.toBe(SOURCE_OPTIONS);
	await writeFile(optionsPath, pinnedOptions);
	git('commit', '-q', '-am', 'Pin template');
	return templateSha;
}

async function runGate(manifest: Record<string, unknown>) {
	const root = await mkdtemp(path.join(tmpdir(), 'create-saas-starter-release-gate-'));
	temporaryDirectories.push(root);
	const checkout = path.join(root, 'checkout');
	const releaseDir = path.join(root, 'release');
	const packageDir = path.join(root, 'pack/package');
	const binDir = path.join(root, 'bin');
	await Promise.all([
		mkdir(checkout),
		mkdir(releaseDir),
		mkdir(path.join(packageDir, 'dist'), { recursive: true }),
		mkdir(binDir)
	]);
	const environment = isolatedEnvironment(root, binDir);
	const templateSha = await createCheckout(checkout, environment);
	await writeFile(
		path.join(packageDir, 'package.json'),
		`${JSON.stringify(manifest, null, '\t')}\n`
	);
	await writeFile(
		path.join(packageDir, 'dist/index.js'),
		`const DEFAULT_TEMPLATE_SHA = '${templateSha}';\n`
	);

	const tarballName = `create-saas-starter-${SOURCE_MANIFEST.version}.tgz`;
	const tarball = path.join(releaseDir, tarballName);
	const packed = spawnSync('tar', ['-czf', tarball, '-C', path.dirname(packageDir), 'package'], {
		env: { ...process.env, COPYFILE_DISABLE: '1' }
	});
	expect(packed.status).toBe(0);
	const sha256 = createHash('sha256')
		.update(await readFile(tarball))
		.digest('hex');
	await writeFile(`${tarball}.sha256`, `${sha256}  ${tarballName}\n`);

	// npm 11 reports a missing version as E404 JSON on stdout and exits 1.
	const npm = path.join(binDir, 'npm');
	await writeFile(
		npm,
		'#!/usr/bin/env bash\necho \'{"error":{"code":"E404","summary":"No match found"}}\'\nexit 1\n'
	);
	await chmod(npm, 0o755);

	const scriptPath = path.join(root, 'gate.sh');
	const outputPath = path.join(root, 'github-output');
	await writeFile(scriptPath, gateScript());
	await writeFile(outputPath, '');
	const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', scriptPath], {
		cwd: checkout,
		encoding: 'utf8',
		env: {
			...environment,
			RELEASE_DIR: releaseDir,
			RUNNER_TEMP: root,
			GITHUB_OUTPUT: outputPath,
			GITHUB_SHA: 'HEAD'
		}
	});
	return { ...result, output: await readFile(outputPath, 'utf8'), sha256 };
}

// The gate is a bash step that needs sha256sum, jq, and an executable npm
// stub, which Windows runners do not provide on this path.
describe.skipIf(process.platform === 'win32')('release gate', () => {
	it('authorizes the source manifest with the pinned template for an unpublished version', async () => {
		const result = await runGate(SOURCE_MANIFEST);

		expect(result.status, result.stdout + result.stderr).toBe(0);
		expect(result.output).toBe(
			`publish=true\nversion=${SOURCE_MANIFEST.version}\nsha256=${result.sha256}\n`
		);
	});

	it.each([
		[
			'redirects the registry through a proxy',
			{ access: 'public', registry: 'http://registry.npmjs.org/', proxy: 'http://127.0.0.1:9/' }
		],
		['drops the publish policy', undefined]
	])('rejects a tarball whose publishConfig %s', async (_, publishConfig) => {
		const result = await runGate({ ...SOURCE_MANIFEST, publishConfig });

		expect(result.status).not.toBe(0);
		expect(result.stdout).toContain('::error::Tarball publishConfig is');
		expect(result.output).toBe('');
	});
});
