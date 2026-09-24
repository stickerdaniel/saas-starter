import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { devNull, tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

interface Pacote {
	manifest(spec: string, options: Record<string, unknown>): Promise<{ publishConfig?: unknown }>;
}

// Loads a module from the npm installation on PATH, as the gate does.
function npmBundled<T>(name: string): T {
	const root = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' });
	expect(root.status, root.stderr).toBe(0);
	return createRequire(import.meta.url)(
		path.join(root.stdout.trim(), 'npm/node_modules', name)
	) as T;
}

interface TarMember {
	name: string;
	data: string | Buffer;
	/** ustar typeflag: '0' is a regular file, '2' a symbolic link. */
	type?: '0' | '2';
	linkname?: string;
	/** Changes the header before its checksum is computed. */
	rewriteHeader?: (header: Buffer) => void;
	/** Formats the checksum field; the default is six octal digits, NUL, space. */
	checksumField?: (checksum: number) => string;
}

// System tar normalizes or refuses the duplicate, dot-segment, symlink, and
// malformed-header members these tests need, so they are written here.
function ustarMembers(members: TarMember[]): Buffer {
	const blocks = members.flatMap(
		({
			name,
			data,
			type = '0',
			linkname = '',
			rewriteHeader,
			checksumField = (checksum) => `${checksum.toString(8).padStart(6, '0')}\0 `
		}) => {
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
			rewriteHeader?.(header);
			const checksum = header.reduce((sum, byte) => sum + byte, 0);
			expect(field(checksumField(checksum), 148)).toBe(8);
			if (type !== '0') return [header];
			const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
			content.copy(padded);
			return [header, padded];
		}
	);
	return Buffer.concat(blocks);
}

function ustarArchive(members: TarMember[]): Buffer {
	return gzipSync(Buffer.concat([ustarMembers(members), Buffer.alloc(1024)]));
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

	// npm 11 reports a missing version as E404 JSON on stdout and exits 1. Every
	// other command, such as the gate's `npm root -g`, reaches the real npm, so
	// the gate loads the same bundled tar and pacote it does in CI.
	const realNpm = spawnSync('bash', ['-c', 'command -v npm'], { encoding: 'utf8' });
	expect(realNpm.status, 'The release gate needs npm on PATH.').toBe(0);
	const npmPath = realNpm.stdout.trim();
	expect(npmPath).not.toContain("'");
	const npm = path.join(binDir, 'npm');
	await writeFile(
		npm,
		[
			'#!/usr/bin/env bash',
			'if [ "$1" = view ]; then',
			'  echo \'{"error":{"code":"E404","summary":"No match found"}}\'',
			'  exit 1',
			'fi',
			`exec '${npmPath}' "$@"`,
			''
		].join('\n')
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
	return { ...result, output: await readFile(outputPath, 'utf8'), sha256, root, tarball };
}

// The gate reads tarballs with the tar and pacote bundled in the npm on PATH,
// and CI runs it with the release toolchain's npm, which must support trusted
// publishing. npm 10 bundles tar 6, which ignores the gate's onReadEntry
// listener, so the gate fails closed there. The release tools CI entry sets
// this variable to `required` so these cases can never be skipped there.
const RELEASE_GATE_TEST = process.env.CREATE_SAAS_STARTER_RELEASE_GATE_TEST ?? '';
const RELEASE_NPM_MINIMUM = '11.5.1';
if (RELEASE_GATE_TEST !== '' && RELEASE_GATE_TEST !== 'required') {
	throw new Error(
		`CREATE_SAAS_STARTER_RELEASE_GATE_TEST must be unset or 'required', not '${RELEASE_GATE_TEST}'.`
	);
}

function npmVersion(): { text: string; parts: number[] } | undefined {
	const result = spawnSync('npm', ['--version'], { encoding: 'utf8' });
	const text = result.status === 0 ? result.stdout.trim() : '';
	const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(text);
	return match ? { text, parts: match.slice(1, 4).map(Number) } : undefined;
}

function atLeast(parts: number[], minimum: string): boolean {
	const required = minimum.split('.').map(Number);
	const index = parts.findIndex((part, position) => part !== required[position]);
	return index === -1 || parts[index]! > required[index]!;
}

// Undefined when the cases run. A missing npm still runs them, so they fail.
function skipReason(): string | undefined {
	if (RELEASE_GATE_TEST === 'required') return undefined;
	// The gate is a bash step that needs sha256sum, jq, and an executable npm
	// stub, which Windows runners do not provide on this path.
	if (process.platform === 'win32') return 'The release gate does not run on Windows.';
	const npm = npmVersion();
	if (npm && npm.parts[0]! < 11) {
		return `Found npm ${npm.text}; the release gate needs the tar that npm 11 or later bundles.`;
	}
	return undefined;
}

const SKIP_REASON = skipReason();

describe('release gate', () => {
	beforeAll(() => {
		if (RELEASE_GATE_TEST !== 'required') return;
		const npm = npmVersion();
		expect(
			npm !== undefined && atLeast(npm.parts, RELEASE_NPM_MINIMUM),
			`The release gate test is required and needs npm ${RELEASE_NPM_MINIMUM} or later, ` +
				`but found ${npm ? `npm ${npm.text}` : 'no readable npm version'}.`
		).toBe(true);
	});

	beforeEach(({ skip }) => {
		if (SKIP_REASON !== undefined) skip(SKIP_REASON);
	});

	it('authorizes the source manifest with the pinned template for an unpublished version', async () => {
		const result = await runGate(SOURCE_MANIFEST);

		expect(result.status, result.stdout + result.stderr).toBe(0);
		expect(result.stdout).toMatch(/^npm bundles tar \d+\.\d+\.\d+\.$/m);
		expect(result.stdout).toMatch(/^npm bundles pacote \d+\.\d+\.\d+\.$/m);
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

	// npm's tar parser warns about a header it rejects and reads the next block
	// as a header, so the rejected README's body becomes a member that supplies
	// the root package.json. Each header below keeps the six allowed names.
	const HIDDEN_MANIFEST = ustarMembers([{ name: 'shadow/package.json', data: UNSAFE_MANIFEST }]);
	it.each<[string, string, Omit<TarMember, 'name' | 'data'>]>([
		['a linkname on a regular file', 'linkpath forbidden', { linkname: 'ignored' }],
		[
			'a mode field in invalid base-256',
			'invalid base256 encoding',
			{ rewriteHeader: (header) => void header.writeUInt8(0x81, 100) }
		],
		[
			'an unterminated eight-digit checksum',
			'checksum failure',
			{ checksumField: (checksum) => checksum.toString(8).padStart(8, '0') }
		]
	])(
		'rejects a published file with %s that hides an unsafe manifest',
		async (_, reason, header) => {
			const result = await runGate(SOURCE_MANIFEST, (members) =>
				members.map((member) =>
					member.name === 'package/README.md'
						? { ...header, name: member.name, data: HIDDEN_MANIFEST }
						: member
				)
			);

			expect(result.status).not.toBe(0);
			expect(result.stdout).toContain(reason);
			expect(result.stdout).toContain(
				'::error::Tarball entries are not exactly the published files.'
			);
			expect(result.output).toBe('');
			// Without the gate, npm would publish with the hidden manifest.
			const manifest = await npmBundled<Pacote>('pacote').manifest(result.tarball, {
				cache: path.join(result.root, 'pacote-cache'),
				fullMetadata: true,
				fullReadJson: true
			});
			expect(manifest.publishConfig).toEqual(JSON.parse(UNSAFE_MANIFEST).publishConfig);
		}
	);
});
