import { describe, expect, it, vi } from 'vitest';
import {
	cloudDevProfileCommands,
	convexDevCommand,
	startAuthoredContentSync
} from './dev-convex-cloud';

describe('startAuthoredContentSync', () => {
	it('generates current content when the combined runner owns the watcher', () => {
		const lifecycle = {
			generate: vi.fn(),
			watch: vi.fn(() => ({ close: vi.fn() }))
		};

		expect(startAuthoredContentSync(false, lifecycle)).toBeNull();
		expect(lifecycle.generate).toHaveBeenCalledOnce();
		expect(lifecycle.watch).not.toHaveBeenCalled();
	});

	it('starts the watcher for direct backend development', () => {
		const watcher = { close: vi.fn() };
		const lifecycle = {
			generate: vi.fn(),
			watch: vi.fn(() => watcher)
		};

		expect(startAuthoredContentSync(true, lifecycle)).toBe(watcher);
		expect(lifecycle.watch).toHaveBeenCalledOnce();
		expect(lifecycle.generate).not.toHaveBeenCalled();
	});
});

describe('cloud development capability profile', () => {
	it('sets and validates preview before starting Convex dev', () => {
		expect(cloudDevProfileCommands()).toEqual([
			['bunx', ['convex', 'env', 'set', 'CAPABILITY_PROFILE', 'preview']],
			['bun', ['scripts/validate-convex-env.ts', '--expected-profile', 'preview']]
		]);
	});
});

describe('convexDevCommand', () => {
	it('forwards Convex CLI arguments', () => {
		expect(convexDevCommand(['--once', '--typecheck', 'disable'])).toEqual([
			'convex',
			'dev',
			'--once',
			'--typecheck',
			'disable'
		]);
	});
});
