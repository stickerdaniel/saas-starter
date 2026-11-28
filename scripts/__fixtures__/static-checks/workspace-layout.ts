import {
	WORKSPACES,
	workspaceAt,
	type StarterWorkspace
} from '../../../.agents/skills/upstream-sync/layout/v3';
import {
	FLAT_CHECK_LAYOUT,
	type CheckLayout,
	type LintProject,
	type Route
} from '../../static-checks';

const EVERY_PATH: Route = { paths: [{ under: '' }] };
const CATALOGS = 'src/i18n/';
const SCRIPTS: Route = { paths: [{ under: 'scripts/', name: /\.ts$/ }] };

/** A CheckLayout for the moved tree of the move table, as a product could write it. */
export const WORKSPACE_CHECK_LAYOUT: CheckLayout = {
	ownerOf: workspaceAt,
	sourceShippedText: /^.+\.svg$/,
	owners: {
		web: {
			directory: WORKSPACES.web.root,
			sources: ['src/'],
			routes: {
				misspell: EVERY_PATH,
				eslint: EVERY_PATH,
				'svelte-check': EVERY_PATH,
				'script-types': { paths: [{ file: 'scripts/tsconfig.json' }, ...SCRIPTS.paths] }
			},
			shippedText: [
				{ under: 'src/lib/content/', name: /^.+\.(?:md|txt)$/ },
				{ file: 'src/app.html' },
				{ under: 'static/', name: /^.+\.(?:txt|md|json|svg|webmanifest)$/ }
			]
		},
		backend: {
			directory: WORKSPACES.backend.root,
			sources: ['confect/', 'convex/', 'convex-components/', 'shared/'],
			routes: {
				misspell: { ...EVERY_PATH, except: [{ containing: 'convex/_generated/' }] },
				eslint: EVERY_PATH,
				'svelte-check': EVERY_PATH,
				'script-types': SCRIPTS,
				convex: {
					paths: [{ under: 'convex/' }, { under: 'confect/' }, { under: 'convex-components/' }]
				}
			},
			shippedText: [{ file: 'confect/support/instructions.txt' }]
		},
		ui: {
			directory: WORKSPACES.ui.root,
			sources: ['src/'],
			routes: {
				misspell: EVERY_PATH,
				eslint: EVERY_PATH,
				'svelte-check': EVERY_PATH
			}
		},
		emails: {
			directory: WORKSPACES.emails.root,
			sources: ['src/'],
			routes: {
				misspell: EVERY_PATH,
				eslint: EVERY_PATH,
				'svelte-check': EVERY_PATH,
				'script-types': SCRIPTS
			}
		},
		'product-config': {
			directory: WORKSPACES['product-config'].root,
			sources: ['src/'],
			routes: {
				misspell: {
					...EVERY_PATH,
					except: [
						{ under: CATALOGS, name: /^(?!languages\.ts$|static-translations\.generated\.ts$)/ }
					]
				},
				eslint: EVERY_PATH,
				'svelte-check': EVERY_PATH
			},
			shippedText: [{ under: CATALOGS, name: /^[^/]+\.json$/ }],
			localeCatalogs: CATALOGS
		},
		tooling: {
			directory: WORKSPACES.tooling.root,
			routes: {
				misspell: EVERY_PATH,
				eslint: EVERY_PATH,
				'svelte-check': EVERY_PATH,
				'cli-types': { paths: [{ file: 'src/windows-job.ts' }] },
				'script-types': { paths: [{ under: 'src/', name: /\.ts$/ }] }
			}
		},
		'eslint-plugin': FLAT_CHECK_LAYOUT.owners['eslint-plugin'],
		'create-saas-starter': FLAT_CHECK_LAYOUT.owners['create-saas-starter'],
		root: FLAT_CHECK_LAYOUT.owners.root
	},
	typeProjects: {
		'svelte-check': {
			runsIn: 'web',
			config: 'tsconfig.json',
			args: ['svelte-check', '--tsconfig', './tsconfig.json', '--tsgo-experimental-api']
		},
		'cli-types': {
			runsIn: 'create-saas-starter',
			config: 'tsconfig.json',
			args: ['run', 'typecheck']
		},
		'skill-types': FLAT_CHECK_LAYOUT.typeProjects['skill-types'],
		'script-types': {
			runsIn: 'web',
			config: 'scripts/tsconfig.json',
			args: ['run', 'check:scripts']
		},
		convex: { runsIn: 'backend', config: 'convex/tsconfig.json', args: ['run', 'check:convex'] }
	},
	lintProjects: Object.fromEntries(
		(Object.keys(WORKSPACES) as StarterWorkspace[]).map((workspace) => {
			const project: LintProject<StarterWorkspace> = {
				title: `${workspace} knip`,
				runsIn: workspace,
				startedBy: [workspace],
				args: ['run', 'knip', '--no-progress'],
				...(workspace === 'create-saas-starter' && { needsCreatorPackage: true })
			};
			return [`${workspace} knip`, project];
		})
	),
	tasks: {
		'svelte-kit sync': { runsIn: 'web', args: ['svelte-kit', 'sync'] },
		'build-emails': { runsIn: 'emails', args: ['scripts/build-emails.ts'] },
		'Autumn config': { runsIn: 'web', args: ['scripts/check-autumn-config.ts'] },
		'convex compat': { runsIn: 'backend', args: ['scripts/convex-consumer-compat.ts'] }
	}
};
