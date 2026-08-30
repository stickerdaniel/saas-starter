import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isolatedGitEnv, sanitizedGitEnv } from './git-context';
import { compatibilityInvocation } from './static-checks';
import { testExecutable } from './test-executable';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'static-checks.ts');
const BUN = testExecutable('bun');
const ESCAPE = String.fromCharCode(0x1b);
const BELL = String.fromCharCode(0x07);

function run(args: string[], env = sanitizedGitEnv()) {
	return spawnSync(BUN, [SCRIPT, ...args], {
		cwd: ROOT,
		encoding: 'utf8',
		env
	});
}

function createCheckerClone(): { directory: string; repository: string } {
	const directory = path.join(ROOT, 'scratch', `static-compat-${process.pid}-${Date.now()}`);
	const repository = path.join(directory, 'repository');
	mkdirSync(directory, { recursive: true });
	try {
		const result = spawnSync(
			'git',
			['clone', '--quiet', '--local', '--no-hardlinks', ROOT, repository],
			{ env: sanitizedGitEnv(), encoding: 'utf8' }
		);
		if (result.status !== 0) throw new Error(`Local checker clone failed: ${result.stderr}`);
		symlinkSync(
			path.join(ROOT, 'node_modules'),
			path.join(repository, 'node_modules'),
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		for (const file of ['static-checks.ts', 'convex-consumer-compat.ts', 'git-context.ts']) {
			copyFileSync(path.join(ROOT, 'scripts', file), path.join(repository, 'scripts', file));
		}
		return { directory, repository };
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

describe('Convex compatibility static-check entrypoint', () => {
	it.skipIf(process.platform === 'win32')(
		'resolves relative and empty PATH entries absolutely',
		() => {
			const directory = path.join(ROOT, 'scratch', `test-executable-${process.pid}-${Date.now()}`);
			const tools = path.join(directory, 'tools');
			const decoy = path.join(directory, 'decoy', 'probe');
			const relativeCommand = path.join(tools, 'probe');
			const currentCommand = path.join(directory, 'current-probe');
			mkdirSync(decoy, { recursive: true });
			mkdirSync(tools, { recursive: true });
			writeFileSync(relativeCommand, '#!/bin/sh\n');
			writeFileSync(currentCommand, '#!/bin/sh\n');
			chmodSync(relativeCommand, 0o755);
			chmodSync(currentCommand, 0o755);
			try {
				expect(testExecutable('probe', directory, { PATH: `decoy${path.delimiter}tools` })).toBe(
					relativeCommand
				);
				expect(testExecutable('current-probe', directory, { PATH: '' })).toBe(currentCommand);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		}
	);

	it('scrubs the child environment without blanking its transport configuration', () => {
		const saved = new Map<string, string | undefined>();
		const overrides = {
			GIT_DIR: path.join(ROOT, 'scratch', 'foreign.git'),
			GIT_WORK_TREE: path.join(ROOT, 'scratch', 'foreign-worktree'),
			GIT_CONFIG_GLOBAL: path.join(ROOT, 'scratch', 'caller.gitconfig')
		};
		for (const [key, value] of Object.entries(overrides)) {
			saved.set(key, process.env[key]);
			process.env[key] = value;
		}
		try {
			const invocation = compatibilityInvocation(true);
			expect(invocation.command).toBe(process.execPath);
			expect(invocation.args).toEqual(['scripts/convex-consumer-compat.ts']);
			// Repository redirections are removed here, because nothing downstream wants them.
			expect(invocation.options.env?.GIT_DIR).toBeUndefined();
			expect(invocation.options.env?.GIT_WORK_TREE).toBeUndefined();
			expect(invocation.options.env?.GIT_ATTR_SOURCE).toBeUndefined();
			// Configuration is not blanked here. The child needs it for the baseline fetch and
			// isolates every verdict-deciding read for itself; a blank path cannot be undone.
			expect(invocation.options.env?.GIT_CONFIG_GLOBAL).toBe(overrides.GIT_CONFIG_GLOBAL);
			expect(invocation.options.env?.GIT_CONFIG_NOSYSTEM).toBeUndefined();
			expect(invocation.options.env?.CI).toBe('true');
		} finally {
			for (const [key, value] of saved) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});

	it('uses the running Bun executable and sanitizes child diagnostics without PATH lookup', () => {
		const env = sanitizedGitEnv();
		env.PATH = '';
		env.CI = 'true';
		env.CONVEX_COMPAT_BASE = `missing ref${ESCAPE}]0;OWNED${BELL}`;
		const result = run(['--scope', 'compat'], env);
		const output = `${result.stdout}${result.stderr}`;

		expect(result.status, output).toBe(1);
		expect(output).toContain('Convex consumer compatibility');
		expect(output).toContain('CONVEX_COMPAT_BASE=missing refU+001B]0;OWNEDU+0007');
		expect(output).not.toContain('Executable not found');
		expect(output).not.toContain(`${ESCAPE}]0;OWNED`);
		expect(output).not.toContain(BELL);
	}, 30_000);

	it('reads real ancestry through local replacements and grafts', () => {
		const directory = path.join(ROOT, 'scratch', `compat-history-${process.pid}-${Date.now()}`);
		mkdirSync(directory, { recursive: true });
		const env = sanitizedGitEnv();
		const git = (args: string[], childEnv = env) =>
			spawnSync('git', ['-c', 'core.useReplaceRefs=true', ...args], {
				cwd: directory,
				env: childEnv,
				encoding: 'utf8'
			});
		try {
			expect(git(['init', '--quiet', '--initial-branch=main']).status).toBe(0);
			for (const [message, contents] of [
				['Initial', 'one\n'],
				['Middle', 'two\n'],
				['Current', 'three\n']
			] as const) {
				writeFileSync(path.join(directory, 'README.md'), contents);
				expect(git(['add', '--', 'README.md']).status).toBe(0);
				expect(
					git([
						'-c',
						'user.name=Probe',
						'-c',
						'user.email=probe@example.com',
						'commit',
						'--quiet',
						'--no-gpg-sign',
						'--no-verify',
						'-m',
						message
					]).status
				).toBe(0);
			}

			const head = git(['rev-parse', 'HEAD']).stdout.trim();
			const realParent = git(['rev-parse', 'HEAD~1']).stdout.trim();
			const oldest = git(['rev-parse', 'HEAD~2']).stdout.trim();
			const tree = git(['write-tree']).stdout.trim();
			const replacement = git([
				'-c',
				'user.name=Probe',
				'-c',
				'user.email=probe@example.com',
				'commit-tree',
				tree,
				'-m',
				'Replacement root'
			]).stdout.trim();
			expect(git(['replace', 'HEAD', replacement]).status).toBe(0);
			expect(git(['rev-parse', 'HEAD~1']).status).not.toBe(0);

			const isolated = isolatedGitEnv();
			const replacementParent = git(['rev-parse', 'HEAD~1'], isolated);
			expect(replacementParent.status, replacementParent.stderr).toBe(0);
			expect(replacementParent.stdout.trim()).toBe(realParent);

			expect(git(['replace', '-d', 'HEAD']).status).toBe(0);
			writeFileSync(path.join(directory, '.git', 'info', 'grafts'), `${head} ${oldest}\n`);
			expect(git(['rev-parse', 'HEAD~1']).stdout.trim()).toBe(oldest);
			const graftParent = git(['rev-parse', 'HEAD~1'], isolated);
			expect(graftParent.status, graftParent.stderr).toBe(0);
			expect(graftParent.stdout.trim()).toBe(realParent);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	}, 30_000);

	it.skipIf(process.platform === 'win32')(
		'protects the direct checker from local ancestry and checkout configuration',
		() => {
			const checkout = createCheckerClone();
			const env = sanitizedGitEnv();
			// The fixture below is the checker's entire history. `CI` and `CONVEX_COMPAT_BASE`
			// survive the scrub by design and would each steer it at a different baseline.
			delete env.CI;
			delete env.CONVEX_COMPAT_BASE;
			const foreignRepository = path.join(checkout.directory, 'foreign-repository');
			const git = (args: string[], childEnv = env) =>
				spawnSync('git', ['-c', 'core.useReplaceRefs=true', ...args], {
					cwd: checkout.repository,
					env: childEnv,
					encoding: 'utf8'
				});
			const foreignGit = (args: string[]) =>
				spawnSync('git', args, { cwd: foreignRepository, env, encoding: 'utf8' });
			try {
				mkdirSync(foreignRepository, { recursive: true });
				expect(foreignGit(['init', '--quiet', '--initial-branch=main']).status).toBe(0);
				expect(foreignGit(['config', 'core.hooksPath', 'original-hooks']).status).toBe(0);
				const tree = git(['write-tree']).stdout.trim();
				const commit = (message: string, parent?: string) =>
					git([
						'-c',
						'user.name=Probe',
						'-c',
						'user.email=probe@example.com',
						'commit-tree',
						tree,
						...(parent ? ['-p', parent] : []),
						'-m',
						message
					]).stdout.trim();
				const root = commit('Root');
				const parent = commit('Parent', root);
				const head = commit('Head', parent);
				expect(git(['update-ref', 'refs/heads/main', head]).status).toBe(0);
				expect(git(['update-ref', 'refs/remotes/origin/main', head]).status).toBe(0);
				expect(git(['checkout', '--quiet', '--detach', head]).status).toBe(0);

				const replacement = commit('Replacement root');
				expect(git(['replace', head, replacement]).status).toBe(0);
				expect(git(['rev-parse', 'HEAD~1']).status).not.toBe(0);

				const hookDirectory = path.join(checkout.directory, 'hooks');
				const marker = path.join(checkout.directory, 'post-checkout-ran');
				const filterMarker = path.join(checkout.directory, 'smudge-filter-ran');
				const filter = path.join(checkout.directory, 'smudge-filter');
				const attributes = path.join(checkout.directory, 'global-attributes');
				const template = path.join(checkout.directory, 'template');
				const config = path.join(checkout.directory, 'global.gitconfig');
				mkdirSync(hookDirectory, { recursive: true });
				writeFileSync(
					path.join(hookDirectory, 'post-checkout'),
					`#!/bin/sh\nprintf hook > ${JSON.stringify(marker)}\n`
				);
				chmodSync(path.join(hookDirectory, 'post-checkout'), 0o755);
				writeFileSync(filter, `#!/bin/sh\ncat\nprintf filter > ${JSON.stringify(filterMarker)}\n`);
				chmodSync(filter, 0o755);
				writeFileSync(attributes, '*.ts filter=compat-probe\n');
				mkdirSync(path.join(template, 'info'), { recursive: true });
				writeFileSync(
					path.join(template, 'config'),
					`[filter "compat-probe"]\n\tsmudge = ${JSON.stringify(filter)}\n\trequired = true\n`
				);
				writeFileSync(path.join(template, 'info', 'attributes'), '*.ts filter=compat-probe\n');
				expect(git(['config', '--file', config, 'core.hooksPath', hookDirectory]).status).toBe(0);
				expect(git(['config', 'core.attributesFile', attributes]).status).toBe(0);
				expect(git(['config', 'filter.compat-probe.smudge', filter]).status).toBe(0);

				const childEnv = {
					...env,
					GIT_CONFIG_GLOBAL: config,
					GIT_DIR: path.join(foreignRepository, '.git'),
					GIT_TEMPLATE_DIR: template,
					GIT_TEST_ASSUME_DIFFERENT_OWNER: '1'
				};
				const result = spawnSync(
					BUN,
					[path.join(checkout.repository, 'scripts', 'convex-consumer-compat.ts')],
					{
						cwd: checkout.repository,
						env: childEnv,
						encoding: 'utf8',
						timeout: 110_000
					}
				);
				const output = `${result.stdout}${result.stderr}`;
				expect(result.status, output).toBe(0);
				expect(output).toContain('referenced functions still published unchanged');
				expect(output).not.toContain('root commit, nothing promised yet');
				expect(existsSync(marker)).toBe(false);
				expect(existsSync(filterMarker)).toBe(false);
				expect(foreignGit(['config', '--get', 'core.hooksPath']).stdout.trim()).toBe(
					'original-hooks'
				);
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		},
		120_000
	);

	it.skipIf(process.platform === 'win32')(
		'rejects an unsafe repository path before the compatibility child runs',
		() => {
			const checkout = createCheckerClone();
			try {
				const payload = `${String.fromCharCode(0x1b)}]0;OWNED${String.fromCharCode(0x07)}`;
				const unsafeDirectory = path.join(checkout.repository, 'scripts', 'unsafe');
				const file = path.join(unsafeDirectory, `bad${payload}.md`);
				mkdirSync(unsafeDirectory, { recursive: true });
				writeFileSync(file, 'safe');
				const result = spawnSync(
					BUN,
					[path.join(checkout.repository, 'scripts', 'static-checks.ts'), '--scope', 'compat'],
					{ cwd: checkout.repository, encoding: 'utf8', env: sanitizedGitEnv() }
				);
				const output = `${result.stdout}${result.stderr}`;

				expect(result.status).toBe(1);
				expect(output).toContain('U+001B');
				expect(output).not.toContain(payload);
				expect(output).not.toContain(String.fromCharCode(0x07));
				expect(output).not.toContain('Convex consumer compatibility');
			} finally {
				rmSync(checkout.directory, { recursive: true, force: true });
			}
		}
	);

	it.each([
		['staged mode', ['--scope', 'compat', '--staged']],
		['an explicit file', ['--scope', 'compat', 'README.md']],
		['--files-from', ['--scope', 'compat', '--files-from', '-']]
	])('rejects %s before starting compatibility', (_label, args) => {
		const result = run(args);
		const output = `${result.stdout}${result.stderr}`;
		expect(result.status).toBe(1);
		expect(output).toContain('--scope compat only supports a full-project run');
		expect(output).not.toContain('Convex consumer compatibility');
	});

	it('keeps abandoned checker clones out of Vitest discovery', () => {
		const config = readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
		expect(config).toContain("'scratch/**'");
	});

	it('owns the package alias', () => {
		const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};
		expect(packageJson.scripts['check:convex-compat']).toBe(
			'bun scripts/static-checks.ts --scope compat'
		);
	});
});
