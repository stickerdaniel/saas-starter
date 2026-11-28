import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	missingPrimitiveCandidates,
	primitivesDirectory,
	scanStylesheet
} from '#lib/components/ui/test-fixtures/tailwind-scan.js';
import { emptyCssSources } from '../../scripts/css-sources.ts';

const fixtures: string[] = [];
afterEach(() => {
	for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true });
});

function fixture(componentDirectory = '') {
	const root = mkdtempSync(join(tmpdir(), 'css-source-'));
	fixtures.push(root);
	mkdirSync(join(root, 'src/routes'), { recursive: true });
	const dependency = join(root, 'node_modules/renderer', componentDirectory);
	mkdirSync(dependency, { recursive: true });
	writeFileSync(join(dependency, 'component.svelte'), '<p>Renderer</p>');
	return join(root, 'src/routes/layout.css');
}

describe('Tailwind dependency source paths', () => {
	it('rejects a project-relative glob and names the stylesheet-relative correction', () => {
		const file = fixture();
		expect(emptyCssSources(file, '@source "../node_modules/renderer/**/*";')).toEqual([
			`${file}:1: @source matches no files; resolve its path relative to this stylesheet so Tailwind includes dependency styles.`
		]);
		expect(emptyCssSources(file, '@source "../../node_modules/renderer/**/*";')).toEqual([]);
	});

	it('accepts a dependency glob whose only component is in a hidden directory', () => {
		const file = fixture('.generated');
		expect(emptyCssSources(file, '@source "../../node_modules/renderer/**/*.svelte";')).toEqual([]);
	});

	it('accepts directories and file paths without treating exclusions, inline sources or comments as globs', () => {
		const file = fixture();
		expect(emptyCssSources(file, '@source "../../node_modules/renderer";')).toEqual([]);
		expect(
			emptyCssSources(file, '@source "../../node_modules/renderer/component.svelte";')
		).toEqual([]);
		expect(
			emptyCssSources(
				file,
				'@source not "missing/**"; @source inline("underline"); @source var(--source); /* @source "missing/**"; */'
			)
		).toEqual([]);
	});

	it('keeps the app stylesheet dependency sources reachable', () => {
		const file = join(import.meta.dirname, 'layout.css');
		expect(emptyCssSources(file, readFileSync(file, 'utf8'))).toEqual([]);
	});
});

describe('Tailwind sources of the app stylesheet', () => {
	it('scans the app, Streamdown and the primitives, and no other part of the checkout', async () => {
		const checkout = mkdtempSync(join(realpathSync(tmpdir()), 'layout-scan-'));
		fixtures.push(checkout);
		mkdirSync(join(checkout, '.git'));
		const appModules = join(import.meta.dirname, '../../node_modules');
		symlinkSync(appModules, join(checkout, 'node_modules'));
		const routes = join(checkout, 'src/routes');
		mkdirSync(routes, { recursive: true });
		const entry = join(routes, 'layout.css');
		copyFileSync(join(import.meta.dirname, 'layout.css'), entry);
		const probe = (directory: string) => {
			const file = join(checkout, directory, 'probe.svelte');
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, '<p class="p-[137px]">Probe</p>\n');
			return file;
		};
		const scanned = [probe('src/routes'), probe('src/lib/scratch')];
		const skipped = [
			probe('src/lib/emails'),
			probe('scratch'),
			probe('.claude/worktrees/agent'),
			probe('scripts')
		];

		const scan = await scanStylesheet(entry, async (id, base) =>
			base === routes && id.startsWith('.') ? resolve(import.meta.dirname, id) : undefined
		);

		const streamdown = realpathSync(join(appModules, 'svelte-streamdown/dist'));
		expect([...scan.files].some((file) => file.startsWith(`${streamdown}/`))).toBe(true);
		expect(scan.files).toContain(join(primitivesDirectory, 'card/card.svelte'));
		expect(missingPrimitiveCandidates(scan)).toEqual([]);
		expect(scanned.filter((file) => !scan.files.has(file))).toEqual([]);
		expect(skipped.filter((file) => scan.files.has(file))).toEqual([]);
	});
});
