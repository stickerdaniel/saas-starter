import { checkCheckoutLayout, verifyCheckoutLayout } from './checkout-layout.ts';
import { checkExports, writeExports, writeImports } from './exports.ts';
import { formatTree } from './format.ts';
import { checkGraph } from './graph.ts';
import { saveManifests, verifyOwners, writeManifests } from './manifests.ts';
import { movePaths, rewriteSpecifiers } from './mapper-steps.ts';
import { OWNERS } from './owners.ts';
import { PROJECT_FILES, verifyOutputs, writeProjects } from './projects.ts';
import { REPLACEMENTS, verifyReplacements, writeReplacements } from './replacements.ts';
import type { Inputs, Run } from './run.ts';

export type { Run } from './run.ts';

export const INPUTS: Inputs = {
	owners: OWNERS,
	projectFiles: PROJECT_FILES,
	replacements: REPLACEMENTS,
	repositoryChecks: true
};

export interface Step {
	readonly name: string;
	/** The file or table the step reads, beyond the flat tree. */
	readonly input: string;
	readonly run: (run: Run) => void | Promise<void>;
	/** Stops on a stale input before any step changes the tree. */
	readonly verify?: (run: Run) => void | Promise<void>;
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
	{
		name: 'checkout layout',
		input:
			'scripts/static-checks.test.ts and scripts/__fixtures__/static-checks/workspace-layout.ts',
		verify: verifyCheckoutLayout,
		run: checkCheckoutLayout
	},
	{
		name: 'projects',
		input: 'scripts/layout/projects.ts',
		verify: verifyOutputs,
		run: writeProjects
	},
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
	{ name: 'check exports', input: 'scripts/workspace-exports.ts', run: checkExports },
	{ name: 'check graph', input: 'scripts/check-workspace-graph.ts', run: checkGraph },
	{
		name: 'format',
		input: 'the root Prettier config, over every file the steps wrote or rewrote',
		run: formatTree
	}
];
