import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
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

interface TarMember {
	name: string;
	data: string;
	/** ustar typeflag: '0' is a regular file, '2' a symbolic link. */
	type?: '0' | '2';
	linkname?: string;
}

// System tar normalizes or refuses the duplicate, dot-segment, and symlink
// members these tests need, so the archive is written as plain ustar here.
function ustarArchive(members: TarMember[]): Buffer {
	const blocks = members.flatMap(({ name, data, type = '0', linkname = '' }) => {
		const content = Buffer.from(data);
		const header = Buffer.alloc(512);
		const field = (value: string, offset: number) => header.write(value, offset, 'latin1');
		const number = (value: number, offset: number, length: number) =>
			field(`${value.toString(8).padStart(length - 1, '0')}\0`, offset);
		expect(Buffer.byteLength(name)).toBeLessThanOrEqual(100);
		field(name, 0);
		number(0o644, 100, 8);
		number(0, 108, 8);
		number(0, 116, 8);
		number(type === '0' ? content.length : 0, 124, 12);
		number(0, 136, 12);
		field(' '.repeat(8), 148);
		field(type, 156);
		field(linkname, 157);
		field('ustar\u000000', 257);
		const checksum = header.reduce((sum, byte) => sum + byte, 0);
		field(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
		if (type !== '0') return [header];
		const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
		content.copy(padded);
		return [header, padded];
	});
	return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

function manifestText(manifest: Record<string, unknown>): string {
	return `${JSON.stringify(manifest, null, '\t')}\n`;
}

// The six files Bun packs, which is the set test:packed requires.
function packedMembers(manifest: Record<string, unknown>, templateSha: string): TarMember[] {
	return [
		{ name: 'package/package.json', data: manifestText(manifest) },
		{ name: 'package/LICENSE', data: 'MIT License\n' },
		{ name: 'package/README.md', data: '# create-saas-starter\n' },
		{ name: 'package/dist/index.js', data: `const DEFAULT_TEMPLATE_SHA = '${templateSha}';\n` },
		{ name: 'package/dist/index.js.map', data: '{}\n' },
		{ name: 'package/dist/windows-job-runner.ps1', data: '# runner\n' }
	];
}

async function runGate(
	manifest: Record<string, unknown>,
	adjust: (members: TarMember[]) => TarMember[] = (members) => members
) {
	const root = await mkdtemp(path.join(tmpdir(), 'create-saas-starter-release-gate-'));
	temporaryDirectories.push(root);
	const checkout = path.join(root, 'checkout');
	const releaseDir = path.join(root, 'release');
	const binDir = path.join(root, 'bin');
	await Promise.all([mkdir(checkout), mkdir(releaseDir), mkdir(binDir)]);
	const environment = isolatedEnvironment(root, binDir);
	const templateSha = await createCheckout(checkout, environment);

	const tarballName = `create-saas-starter-${SOURCE_MANIFEST.version}.tgz`;
	const tarball = path.join(releaseDir, tarballName);
	const archive = ustarArchive(adjust(packedMembers(manifest, templateSha)));
	await writeFile(tarball, archive);
	const sha256 = createHash('sha256').update(archive).digest('hex');
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

	// npm strips package/ and reads whichever root package.json it extracts
	// last, so these members could hand npm an unchecked manifest.
	const UNSAFE_MANIFEST = manifestText({
		...SOURCE_MANIFEST,
		publishConfig: {
			access: 'public',
			scope: 'review',
			'@review:registry': 'http://registry.npmjs.org/',
			proxy: 'http://127.0.0.1:9/'
		}
	});
	it.each<[string, (members: TarMember[]) => TarMember[]]>([
		[
			'an unsafe manifest under another root',
			(members) => [...members, { name: 'shadow/package.json', data: UNSAFE_MANIFEST }]
		],
		[
			'a duplicate package.json',
			(members) => [...members, { name: 'package/package.json', data: UNSAFE_MANIFEST }]
		],
		[
			'a dot-segment alias of package.json',
			(members) => [...members, { name: 'package/./package.json', data: UNSAFE_MANIFEST }]
		],
		[
			'an extra harmless file',
			(members) => [...members, { name: 'package/dist/notes.txt', data: 'notes\n' }]
		],
		[
			'a symbolic link in place of a published file',
			(members) =>
				members.map((member) =>
					member.name === 'package/README.md'
						? { name: member.name, data: '', type: '2', linkname: 'package.json' }
						: member
				)
		]
	])('rejects a tarball with %s', async (_, adjust) => {
		const result = await runGate(SOURCE_MANIFEST, adjust);

		expect(result.status).not.toBe(0);
		expect(result.stdout).toContain(
			'::error::Tarball entries are not exactly the published files.'
		);
		expect(result.output).toBe('');
	});
});
