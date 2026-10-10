import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
