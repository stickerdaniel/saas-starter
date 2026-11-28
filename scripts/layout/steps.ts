import { checkExports, writeExports, writeImports } from './exports.ts';
import { saveManifests, verifyOwners, writeManifests } from './manifests.ts';
import { movePaths, rewriteSpecifiers } from './mapper-steps.ts';
import { writeProjects } from './projects.ts';
import { verifyReplacements, writeReplacements } from './replacements.ts';
import type { Run } from './run.ts';

export type { Run } from './run.ts';

export interface Step {
	readonly name: string;
	/** The file or table the step reads, beyond the flat tree. */
	readonly input: string;
	readonly run: (run: Run) => void;
	/** Stops on a stale input before any step changes the tree. */
	readonly verify?: (run: Run) => void;
}

export const STEPS: readonly Step[] = [
	{ name: 'move', input: '.agents/skills/upstream-sync/layout/v3.ts', run: movePaths },
	{
		name: 'specifiers',
		input: '.agents/skills/upstream-sync/scripts/apply-layout.ts --specifiers',
		run: rewriteSpecifiers
	},
	{
		name: 'replacements',
		input: 'scripts/layout/replacements.ts',
		verify: verifyReplacements,
		run: writeReplacements
	},
	{ name: 'projects', input: 'scripts/layout/projects.ts', run: writeProjects },
	{
		name: 'manifests',
		input: 'scripts/layout/owners.ts',
		verify: verifyOwners,
		run: (run) => {
			writeManifests(run);
			saveManifests(run);
		}
	},
	{
		name: 'imports',
		input: 'the alias imports that apply-layout.ts keeps',
		run: writeImports
	},
	{
		name: 'exports',
		input: 'the package specifiers that apply-layout.ts writes',
		run: writeExports
	},
	{ name: 'check exports', input: 'scripts/workspace-exports.ts', run: checkExports }
];
