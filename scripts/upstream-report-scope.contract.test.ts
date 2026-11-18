import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

/**
 * The upstream-report job runs its test selection before `bun install`, so the selection
 * script can import Node built-ins only. The producer is the script's import list; the
 * consumer is the job's step order.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/upstream-report-scope.ts');

const steps =
	(
		parseYaml(readFileSync(path.join(ROOT, '.github/workflows/static-checks.yml'), 'utf8')) as {
			jobs: Record<string, { steps?: Array<{ id?: string; run?: string }> } | undefined>;
		}
	).jobs['upstream-report-tests']?.steps ?? [];

/** Module specifiers of `source` that a runtime without `node_modules` cannot resolve. */
function packageImports(source: string): string[] {
	const file = ts.createSourceFile(SCRIPT, source, ts.ScriptTarget.Latest);
	return file.statements
		.flatMap((statement) =>
			ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
				? [statement.moduleSpecifier.text]
				: []
		)
		.filter((specifier) => !specifier.startsWith('node:'));
}

describe('upstream report test selection', () => {
	const source = readFileSync(SCRIPT, 'utf8');

	it('runs before the install and imports Node built-ins only', () => {
		const selection = steps.findIndex((step) => step.id === 'scope');
		const install = steps.findIndex((step) => step.run?.includes('bun install'));
		expect(selection).toBeGreaterThanOrEqual(0);
		expect(selection).toBeLessThan(install);
		expect(source).toMatch(/^import /m);
		expect(packageImports(source)).toEqual([]);
	});

	it('rejects a selection that imports a package', () => {
		expect(packageImports(`import { parse } from 'yaml';\n${source}`)).toContain('yaml');
	});
});
