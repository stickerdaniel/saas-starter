import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');
const PACKAGE_ROOT = path.join(REPOSITORY_ROOT, 'packages/create-saas-starter');
const SOURCE_MANIFEST = JSON.parse(
	readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')
) as Record<string, unknown> & { version: string };
const TEMPLATE_SHA = /^export const DEFAULT_TEMPLATE_SHA = '([0-9a-f]{40})';$/m.exec(
	readFileSync(path.join(PACKAGE_ROOT, 'src/options.ts'), 'utf8')
)![1]!;

// The gate checks the template pin against Git history, which a shallow CI
// checkout lacks. Windows runners have no bash with the gate's GNU tools.
const pinInCheckout =
	spawnSync('git', ['cat-file', '-e', `${TEMPLATE_SHA}^{commit}`], { cwd: REPOSITORY_ROOT })
		.status === 0;

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

async function runGate(manifest: Record<string, unknown>) {
	const root = await mkdtemp(path.join(tmpdir(), 'create-saas-starter-release-gate-'));
	temporaryDirectories.push(root);
	const releaseDir = path.join(root, 'release');
	const packageDir = path.join(root, 'pack/package');
	const binDir = path.join(root, 'bin');
	await Promise.all([
		mkdir(releaseDir),
		mkdir(path.join(packageDir, 'dist'), { recursive: true }),
		mkdir(binDir)
	]);
	await writeFile(
		path.join(packageDir, 'package.json'),
		`${JSON.stringify(manifest, null, '\t')}\n`
	);
	await writeFile(
		path.join(packageDir, 'dist/index.js'),
		`const DEFAULT_TEMPLATE_SHA = '${TEMPLATE_SHA}';\n`
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
		cwd: REPOSITORY_ROOT,
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
			RELEASE_DIR: releaseDir,
			RUNNER_TEMP: root,
			GITHUB_OUTPUT: outputPath,
			GITHUB_SHA: 'HEAD'
		}
	});
	return { ...result, output: await readFile(outputPath, 'utf8'), sha256 };
}

describe.skipIf(process.platform === 'win32' || !pinInCheckout)('release gate', () => {
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
