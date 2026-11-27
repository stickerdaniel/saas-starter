import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BASE_TABLE, type EdgePair } from '../layout/v3';
import {
	compareEdges,
	forbiddenEdges,
	forbiddenPairs,
	readImportEdges,
	selectRatchet,
	trackedPaths
} from './apply-layout';

const CHECKOUT = resolve(import.meta.dirname, '../../../..');

const KNOWN_EDGES: readonly EdgePair[] = [
	['packages/create-saas-starter/test/process.test.ts', 'scripts/template-setup.ts'],
	[
		'src/lib/components/ui/confirm-dialog/confirm-dialog.svelte.test.ts',
		'node_modules/svelte/src/index-client.js'
	],
	['src/lib/components/ui/confirm-dialog/confirm-dialog.svelte.test.ts', 'src/i18n/en.json'],
	[
		'src/lib/components/ui/data-table/data-table.svelte.ts',
		'src/lib/components/tables/skeleton.ts'
	],
	[
		'src/lib/components/ui/data-table/data-table.svelte.ts',
		'src/lib/components/truncated-text.svelte'
	],
	[
		'src/lib/components/ui/data-table/data-table.test.ts',
		'node_modules/svelte/src/index-client.js'
	],
	[
		'src/lib/components/ui/data-table/row-selection.test.ts',
		'node_modules/svelte/src/index-client.js'
	],
	[
		'src/lib/components/ui/light-switch/test-fixtures/ThemeRevealHarness.svelte',
		'src/i18n/en.json'
	],
	[
		'src/lib/components/ui/light-switch/theme-reveal.test.ts',
		'node_modules/svelte/src/index-client.js'
	],
	[
		'src/lib/components/ui/loading-bar/loading-bar.test.ts',
		'node_modules/svelte/src/index-client.js'
	],
	[
		'src/lib/components/ui/password/password-toggle-visibility.svelte',
		'src/lib/components/motion/icon-swap.svelte'
	],
	['src/lib/components/ui/password/password.test.ts', 'node_modules/svelte/src/index-client.js'],
	['src/lib/components/ui/password/test-fixtures/PasswordHarness.svelte', 'src/i18n/en.json'],
	['src/lib/components/ui/sidebar/sidebar-provider.svelte', '$app/navigation'],
	[
		'src/lib/components/ui/sliding-header/sliding-header.svelte',
		'src/lib/components/customer-support/avatar-heading.svelte'
	],
	[
		'src/lib/components/ui/sliding-header/sliding-header.svelte',
		'src/lib/components/customer-support/navigation-button.svelte'
	],
	['src/lib/components/ui/sonner/lazy-toaster.test.ts', 'node_modules/svelte/src/index-client.js'],
	['src/lib/components/ui/sonner/sonner.test.ts', 'node_modules/svelte/src/index-client.js'],
	['src/lib/components/ui/tooltip/tooltip-content.test.ts', 'src/routes/layout.css'],
	[
		'src/lib/confect/__goldens__/_generated/apiTypes.ts',
		'node_modules/@useautumn/convex/dist/client/helpers/utils'
	],
	[
		'src/lib/confect/__tests__/messages.test.ts',
		'node_modules/@convex-dev/rate-limiter/dist/component/schema.js'
	],
	[
		'src/lib/confect/__tests__/users.test.ts',
		'node_modules/@convex-dev/rate-limiter/dist/component/schema.js'
	],
	[
		'src/lib/confect/admin/support/mutations.access.test.ts',
		'node_modules/@convex-dev/agent/dist/component/schema.js'
	],
	[
		'src/lib/confect/admin/support/notifications.access.test.ts',
		'node_modules/@convex-dev/agent/dist/component/schema.js'
	],
	[
		'src/lib/confect/aiChat/__tests__/files.access.test.ts',
		'node_modules/@convex-dev/rate-limiter/dist/component/schema.js'
	],
	[
		'src/lib/confect/aiChat/__tests__/messages.access.test.ts',
		'node_modules/@convex-dev/agent/dist/component/schema.js'
	],
	[
		'src/lib/confect/aiChat/__tests__/messages.access.test.ts',
		'node_modules/@convex-dev/rate-limiter/dist/component/schema.js'
	],
	[
		'src/lib/confect/aiChat/__tests__/replyOutcome.test.ts',
		'node_modules/@convex-dev/agent/dist/component/schema.js'
	],
	[
		'src/lib/confect/aiChat/__tests__/replyOutcome.test.ts',
		'node_modules/@convex-dev/rate-limiter/dist/component/schema.js'
	],
	[
		'src/lib/confect/aiChat/__tests__/replyOutcome.test.ts',
		'src/lib/chat/core/chat-session-port.svelte.ts'
	],
	['src/lib/confect/aiChat/__tests__/replyOutcome.test.ts', 'src/lib/chat/core/optimistic.ts'],
	['src/lib/confect/aiChat/__tests__/replyOutcome.test.ts', 'src/lib/chat/core/stream-cache.ts'],
	['src/lib/confect/aiChat/__tests__/replyOutcome.test.ts', 'src/lib/chat/ui/streaming-display.ts'],
	[
		'src/lib/confect/aiChat/__tests__/threads.access.test.ts',
		'node_modules/@convex-dev/agent/dist/component/schema.js'
	],
	[
		'src/lib/confect/aiChat/__tests__/threads.access.test.ts',
		'node_modules/@convex-dev/rate-limiter/dist/component/schema.js'
	],
	[
		'src/lib/confect/emails/founderIncidentDrafts.test.ts',
		'node_modules/@convex-dev/resend/dist/component/schema.js'
	],
	[
		'src/lib/confect/files/__tests__/uploadRoute.test.ts',
		'node_modules/@convex-dev/agent/dist/component/schema.js'
	],
	[
		'src/lib/confect/files/__tests__/uploadRoute.test.ts',
		'node_modules/@convex-dev/rate-limiter/dist/component/schema.js'
	],
	[
		'src/lib/confect/files/__tests__/vacuum.test.ts',
		'node_modules/@convex-dev/agent/dist/component/schema.js'
	],
	[
		'src/lib/confect/goldens.runtime.test.ts',
		'node_modules/@convex-dev/agent/dist/component/schema.js'
	],
	[
		'src/lib/confect/goldens.runtime.test.ts',
		'node_modules/@convex-dev/rate-limiter/dist/component/schema.js'
	],
	[
		'src/lib/confect/goldens.runtime.test.ts',
		'node_modules/@convex-dev/resend/dist/component/schema.js'
	],
	[
		'src/lib/confect/goldens.runtime.test.ts',
		'node_modules/@gilhrpenner/convex-files-control/dist/component/schema.js'
	],
	['src/lib/confect/logging.test.ts', 'src/lib/server/effect-runtime.ts'],
	['src/lib/confect/middleware/policies.test.ts', 'src/lib/utils/auth-messages.ts'],
	['src/lib/confect/middleware/policies.test.ts', 'src/lib/utils/convex-errors.ts'],
	[
		'src/lib/confect/support/__tests__/deleteEmptyThreads.test.ts',
		'node_modules/@convex-dev/agent/dist/component/schema.js'
	],
	[
		'src/lib/confect/support/__tests__/internalSetHandoff.test.ts',
		'node_modules/@convex-dev/agent/dist/component/schema.js'
	],
	[
		'src/lib/confect/support/__tests__/internalSetHandoff.test.ts',
		'node_modules/@convex-dev/rate-limiter/dist/component/schema.js'
	],
	[
		'src/lib/confect/support/files.access.test.ts',
		'node_modules/@convex-dev/rate-limiter/dist/component/schema.js'
	],
	[
		'src/lib/confect/support/messages.access.test.ts',
		'node_modules/@convex-dev/agent/dist/component/schema.js'
	],
	[
		'src/lib/confect/support/messages.access.test.ts',
		'node_modules/@convex-dev/rate-limiter/dist/component/schema.js'
	],
	[
		'src/lib/confect/support/migration.access.test.ts',
		'node_modules/@convex-dev/agent/dist/component/schema.js'
	],
	[
		'src/lib/confect/support/migration.access.test.ts',
		'node_modules/@convex-dev/rate-limiter/dist/component/schema.js'
	],
	[
		'src/lib/confect/support/threads.access.test.ts',
		'node_modules/@convex-dev/agent/dist/component/schema.js'
	],
	[
		'src/lib/confect/support/threads.access.test.ts',
		'node_modules/@convex-dev/rate-limiter/dist/component/schema.js'
	],
	['src/lib/emails/__tests__/email-rendering.test.ts', 'src/lib/confect/emails/templates.ts'],
	['src/lib/emails/__tests__/email-rendering.test.ts', 'src/lib/confect/env.ts'],
	['src/lib/emails/renderer.ts', 'src/routes/layout.css'],
	['src/lib/hooks/use-haptic.svelte.test.ts', '$app/env'],
	['src/lib/hooks/use-haptic.svelte.ts', '$app/env']
];

const pairs = (edges: ReadonlyArray<{ from: string; target: string }>) => [
	...new Set(edges.map(({ from, target }) => `${from} -> ${target}`))
];

const ratchet = await selectRatchet(CHECKOUT);

describe('the workspace boundary', () => {
	it('holds on this checkout except for the known edges', (context) => {
		const known = ratchet.knownEdges === 'starter' ? KNOWN_EDGES : ratchet.knownEdges;
		if ('skip' in known) return context.skip(known.skip);
		expect(ratchet.refusals).toEqual([]);
		const found = forbiddenPairs(ratchet.table, readImportEdges(CHECKOUT, trackedPaths(CHECKOUT)));
		const { added, gone } = compareEdges(found, known);
		expect(added, 'new forbidden edges').toEqual([]);
		expect(gone, 'known edges that are gone').toEqual([]);
	}, 60_000);
});

describe('forbiddenEdges', () => {
	const fixtures: string[] = [];
	afterEach(() => {
		for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
	});

	function tree(files: Record<string, string>): { root: string; paths: string[] } {
		const root = mkdtempSync(join(tmpdir(), 'workspace-boundary-'));
		fixtures.push(root);
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), content);
		}
		return { root, paths: Object.keys(files) };
	}

	it('reads imports, mocks, Kit modules, install paths and path reads of tests and harnesses', () => {
		const { root, paths } = tree({
			'package.json': JSON.stringify({ imports: { '#lib/*': './src/lib/*' } }),
			'src/routes/+page.ts': '',
			'src/routes/layout.css': '',
			'src/lib/components/ui/x/Harness.svelte':
				'<script lang="ts">\n\timport { load } from \'../../../../routes/+page\';\n</script>\n',
			'src/lib/components/ui/x/kit.ts': "import { goto } from '$app/navigation';\n",
			'src/lib/components/ui/x/svelte.test.ts':
				"vi.importActual('../../../../../node_modules/svelte/src/index-client.js');\n",
			'src/lib/components/ui/x/read.test.ts':
				"readFileSync(join(import.meta.dirname, '../../../../routes/layout.css'));\n",
			'src/lib/components/ui/x/rule.test.ts':
				'const code = "import a from \'#lib/components/app.svelte\';";\n',
			'src/lib/chat/svelte.test.ts':
				"vi.importActual('../../../node_modules/svelte/src/index-client.js');\n",
			'src/lib/emails/mail.ts': "import { goto } from '#lib/components/ui/x/kit';\n"
		});
		expect(pairs(forbiddenEdges(BASE_TABLE, readImportEdges(root, paths))).sort()).toEqual([
			'src/lib/components/ui/x/Harness.svelte -> src/routes/+page.ts',
			'src/lib/components/ui/x/kit.ts -> $app/navigation',
			'src/lib/components/ui/x/read.test.ts -> src/routes/layout.css',
			'src/lib/components/ui/x/svelte.test.ts -> node_modules/svelte/src/index-client.js'
		]);
	});

	it('lets every workspace read the repository tools and none read the root', () => {
		const { root, paths } = tree({
			'package.json': '{}',
			'scripts/git-context.ts': '',
			'scripts/static-checks.ts': "import { gitContext } from './git-context';\n",
			'scripts/dev.ts':
				"import { gitContext } from './git-context';\nimport { run } from './static-checks';\n",
			'scripts/template-setup.ts': "import { gitContext } from './git-context';\n",
			'packages/create-saas-starter/test/setup.test.ts':
				"readFileSync(join(import.meta.dirname, '../../../scripts/template-setup.ts'));\n"
		});
		expect(pairs(forbiddenEdges(BASE_TABLE, readImportEdges(root, paths))).sort()).toEqual([
			'packages/create-saas-starter/test/setup.test.ts -> scripts/template-setup.ts',
			'scripts/dev.ts -> scripts/static-checks.ts'
		]);
	});
});
