import {
	WORKSPACES,
	workspaceAt,
	type StarterWorkspace
} from '../../../.agents/skills/upstream-sync/layout/v3';
import type { CheckLayout, LintProject, Route } from '../../static-checks';

const EVERY_PATH: Route = { paths: [{ under: '' }] };
const CATALOGS = 'src/i18n/';
const SCRIPTS: Route = { paths: [{ under: 'scripts/', name: /\.ts$/ }] };
const ENGLISH_POLICY_BUNDLE = { file: 'scripts/english-policy/pr-metadata.bundle.mjs' };
const SKILL_TYPES = '.agents/skills/tsconfig.json';

/** Where each check finds its files and runs in the workspace tree. */
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
		'eslint-plugin': {
			directory: WORKSPACES['eslint-plugin'].root,
			routes: { misspell: EVERY_PATH, eslint: EVERY_PATH, 'svelte-check': EVERY_PATH }
		},
		'create-saas-starter': {
			directory: WORKSPACES['create-saas-starter'].root,
			routes: {
				misspell: EVERY_PATH,
				eslint: EVERY_PATH,
				'cli-types': {
					paths: [{ under: '', name: /(?:^|\/)(?:package\.json|bun\.lock|tsconfig\.json)$|\.ts$/ }]
				}
			}
		},
		root: {
			directory: WORKSPACES.root.root,
			routes: {
				misspell: { ...EVERY_PATH, except: [ENGLISH_POLICY_BUNDLE] },
				eslint: { ...EVERY_PATH, except: [ENGLISH_POLICY_BUNDLE] },
				'svelte-check': EVERY_PATH,
				'skill-types': {
					paths: [
						{ file: SKILL_TYPES },
						{ under: '.agents/skills/', name: /^[^/]+\/scripts\/.+\.ts$/ }
					]
				},
				'script-types': SCRIPTS
			}
		}
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
		'skill-types': { runsIn: 'root', config: SKILL_TYPES, args: ['run', 'check:skills'] },
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
