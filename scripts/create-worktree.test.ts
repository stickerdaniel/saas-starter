// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('creator dependency bootstrap', () => {
	it('keeps the normal root lifecycle and installs the child lockfile explicitly', () => {
		const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
			scripts: Record<string, string>;
		};

		expect(manifest.scripts['install:cli']).toBe(
			'bun install --cwd packages/create-saas-starter --frozen-lockfile'
		);
		expect(manifest.scripts.postinstall).toBe(
			'bun run install:cli && bun run generate:content && bun svelte-kit sync && varlock codegen && varlock codegen --path .env-convex.schema && bun run build:emails'
		);
	});

	it('uses the frozen root path when provisioning a worktree', () => {
		const source = readFileSync(path.join(ROOT, 'scripts/create-worktree.ts'), 'utf8');
		const installs = source.match(/runCommandInherit\('bun', \['install'[^\n]+/g) ?? [];

		expect(installs).toEqual(["runCommandInherit('bun', ['install', '--frozen-lockfile'])) {"]);
	});
});
