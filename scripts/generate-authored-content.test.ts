import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
	initializeAuthoredContentWatcher,
	renderGeneratedSupportInstructions
} from './generate-authored-content';
import { testExecutable } from './test-executable';

describe('initializeAuthoredContentWatcher', () => {
	it('registers the watcher before the initial generation', () => {
		const order: string[] = [];
		const watcher = { close: vi.fn() };

		expect(
			initializeAuthoredContentWatcher(
				() => {
					order.push('watch');
					return watcher;
				},
				() => order.push('generate')
			)
		).toBe(watcher);
		expect(order).toEqual(['watch', 'generate']);
	});

	it('closes the watcher when initial generation fails', () => {
		const watcher = { close: vi.fn() };
		expect(() =>
			initializeAuthoredContentWatcher(
				() => watcher,
				() => {
					throw new Error('generation failed');
				}
			)
		).toThrow('generation failed');
		expect(watcher.close).toHaveBeenCalledOnce();
	});
});

describe('renderGeneratedSupportInstructions', () => {
	it('normalizes line endings and safely serializes prompt syntax', () => {
		const generated = renderGeneratedSupportInstructions('Use `code` and ${value}.\r\n');

		expect(generated).toContain('export const SUPPORT_AGENT_INSTRUCTIONS_TEMPLATE = ');
		expect(generated).toContain('Use `code` and ${value}.');
		expect(generated).not.toContain('\r');
	});
});

describe('generate-authored-content.ts', () => {
	it('removes the stale outputs from the Convex functions directory and nothing else', () => {
		const root = mkdtempSync(path.join(tmpdir(), 'authored-content-'));
		try {
			const at = (file: string) => path.join(root, file);
			const write = (file: string, text: string) => {
				mkdirSync(path.dirname(at(file)), { recursive: true });
				writeFileSync(at(file), text);
			};
			mkdirSync(at('scripts'));
			copyFileSync(
				fileURLToPath(new URL('./generate-authored-content.ts', import.meta.url)),
				at('scripts/generate-authored-content.ts')
			);
			write('src/lib/confect/support/instructions.txt', 'Answer briefly.\n');
			write('src/lib/convex/support/instructions.generated.ts', 'export const stale = 1;\n');
			write('src/lib/convex/convex-env.d.ts', 'export {};\n');
			write('src/lib/convex/support/threads.ts', 'export const authored = 1;\n');

			const run = spawnSync(testExecutable('bun'), ['scripts/generate-authored-content.ts'], {
				cwd: root,
				encoding: 'utf8'
			});

			expect(run.status, run.stderr).toBe(0);
			expect(existsSync(at('src/lib/convex/support/instructions.generated.ts'))).toBe(false);
			expect(existsSync(at('src/lib/convex/convex-env.d.ts'))).toBe(false);
			expect(existsSync(at('src/lib/convex/support/threads.ts'))).toBe(true);
			expect(existsSync(at('src/lib/confect/support/instructions.generated.ts'))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
