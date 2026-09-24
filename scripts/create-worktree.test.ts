// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('creator dependency bootstrap', () => {
	it('uses the frozen root path when provisioning a worktree', () => {
		const source = readFileSync(path.join(ROOT, 'scripts/create-worktree.ts'), 'utf8');
		const installs = source.match(/runCommandInherit\('bun', \['install'[^\n]+/g) ?? [];

		expect(installs).toEqual(["runCommandInherit('bun', ['install', '--frozen-lockfile'])) {"]);
	});
});
