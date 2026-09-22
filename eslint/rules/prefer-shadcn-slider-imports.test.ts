// @vitest-environment node
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const eslint = new ESLint({ cwd: repoRoot });
const subdirectoryEslint = new ESLint({ cwd: path.join(repoRoot, 'src') });
const ruleId = 'local/prefer-shadcn-slider-imports';
const boundaryMessage =
	'Use named Bits UI imports and the shadcn Slider wrapper so Slider enforcement remains statically decidable.';
const sliderMessage = 'Import Slider from $lib/components/ui/slider/index.js instead of bits-ui.';

async function sliderMessages(source: string, filePath = 'src/lib/analytics/posthog.ts') {
	const [result] = await eslint.lintText(source, { filePath });
	expect(result.fatalErrorCount).toBe(0);
	return result.messages.filter((message) => message.ruleId === ruleId);
}

function boundaryColumn(source: string, site: 'namespace' | 'dynamic' | 'export') {
	if (site === 'namespace') return source.indexOf('*') + 1;
	if (site === 'dynamic') return source.indexOf('import(') + 1;
	return source.indexOf('export') + 1;
}

const prohibitedSliderBindings = [
	['named import', "import { Slider } from 'bits-ui';"],
	['aliased import', "import { Slider as RangeControl } from 'bits-ui';"],
	['string-literal import', "import { 'Slider' as RangeControl } from 'bits-ui';"],
	['named re-export', "export { Slider } from 'bits-ui';"],
	['aliased re-export', "export { Slider as RangeControl } from 'bits-ui';"],
	['string-literal re-export', "export { 'Slider' as RangeControl } from 'bits-ui';"]
] as const;

const prohibitedBoundaries = [
	['namespace import', "import * as Bits from 'bits-ui';", 'namespace'],
	['wildcard re-export', "export * from 'bits-ui';", 'export'],
	['namespace re-export', "export * as Bits from 'bits-ui';", 'export'],
	['literal dynamic import', "void import('bits-ui');", 'dynamic'],
	['static template dynamic import', 'void import(`bits-ui`);', 'dynamic'],
	['as-wrapped literal dynamic import', "void import('bits-ui' as string);", 'dynamic'],
	[
		'satisfies-wrapped literal dynamic import',
		"void import('bits-ui' satisfies string);",
		'dynamic'
	],
	['assertion-wrapped literal dynamic import', "void import(<string>'bits-ui');", 'dynamic'],
	['non-null-wrapped literal dynamic import', "void import('bits-ui'!);", 'dynamic']
] as const;

const latestProScenarios = [
	[
		'namespace exported through an object',
		"import * as Bits from 'bits-ui'; export const controls = { Bits };",
		'namespace'
	],
	[
		'namespace stored by mutation',
		"import * as Bits from 'bits-ui'; const controls = {}; controls.bits = Bits;",
		'namespace'
	],
	[
		'namespace returned from a deferred function',
		"import * as Bits from 'bits-ui'; const load = () => Bits; void load;",
		'namespace'
	],
	[
		'dynamic namespace exported as a promise',
		"export const controls = import('bits-ui');",
		'dynamic'
	],
	[
		'dynamic namespace assigned after declaration',
		"let controls; controls = import('bits-ui');",
		'dynamic'
	],
	[
		'namespace captured by a Svelte script function',
		"<script>import * as Bits from 'bits-ui'; const load = () => Bits;</script>",
		'namespace',
		'src/lib/components/authenticated/authenticated-sidebar.svelte'
	]
] as const;

const permitted = [
	['named Button import', "import { Button } from 'bits-ui'; void Button;"],
	['aliased Button import', "import { Button as Trigger } from 'bits-ui'; void Trigger;"],
	['named Button re-export', "export { Button } from 'bits-ui';"],
	['aliased Button re-export', "export { Button as Trigger } from 'bits-ui';"],
	['type-only import declaration', "import type { Slider } from 'bits-ui';"],
	['type-only namespace import', "import type * as Bits from 'bits-ui';"],
	[
		'type-only import specifier',
		"import { type Slider, Button } from 'bits-ui'; type RangeControl = Slider; void Button;"
	],
	['type-only re-export', "export type { Slider } from 'bits-ui';"],
	['mixed type and runtime re-export', "export { type Slider, Button } from 'bits-ui';"],
	['type-only wildcard re-export', "export type * from 'bits-ui';"],
	['type-only namespace re-export', "export type * as Bits from 'bits-ui';"],
	['type query import', "type Bits = typeof import('bits-ui');"],
	['TypeScript import type', "type Button = import('bits-ui').Button;"],
	[
		'nonliteral dynamic import',
		"const source = 'bits-ui'; const { Slider } = await import(source); void Slider;"
	],
	['wrapper import', "import { Slider } from '$lib/components/ui/slider/index.js'; void Slider;"],
	[
		'nonliteral dynamic import with a non-null source',
		"const source = 'bits-ui'; const { Slider } = await import(source!); void Slider;"
	]
] as const;

describe('prefer-shadcn-slider-imports production configuration', () => {
	it.each([
		[
			'TypeScript',
			'src/lib/analytics/posthog.ts',
			"import { Slider } from 'bits-ui';",
			'directSliderImport'
		],
		[
			'JavaScript',
			'src/lib/security/csp.js',
			"import * as Bits from 'bits-ui';",
			'staticBitsBoundary'
		],
		[
			'Svelte module',
			'src/lib/chat/core/chat-core.svelte.ts',
			"void import('bits-ui');",
			'staticBitsBoundary'
		],
		[
			'Svelte component',
			'src/lib/components/authenticated/authenticated-sidebar.svelte',
			"<script>import * as Bits from 'bits-ui';</script>",
			'staticBitsBoundary'
		]
	] as const)(
		'enforces the boundary in %s files',
		async (_label, filePath, source, messageId) => {
			expect(existsSync(path.join(repoRoot, filePath))).toBe(true);
			const config = await eslint.calculateConfigForFile(filePath);
			expect(config?.rules?.[ruleId]?.[0]).toBe(2);
			if (!filePath.endsWith('.svelte')) {
				expect(config?.rules?.['local/prefer-shadcn-primitives']).toBeUndefined();
			}
			const messages = await sliderMessages(source, filePath);
			expect(messages).toHaveLength(1);
			expect(messages[0].messageId).toBe(messageId);
		},
		60_000
	);

	it.each([
		'src/routes/components/ui/+page.svelte',
		'src/features/payments/components/ui/controls.ts'
	])('does not exempt application path %s', async (filePath) => {
		const source = filePath.endsWith('.svelte')
			? '<script lang="ts">import { Slider } from \'bits-ui\';</script>'
			: "import { Slider } from 'bits-ui';";
		const temporaryRoot = filePath.endsWith('.svelte')
			? path.join(repoRoot, 'src/routes/components')
			: null;
		if (temporaryRoot) {
			expect(existsSync(temporaryRoot)).toBe(false);
			await mkdir(path.dirname(path.join(repoRoot, filePath)), { recursive: true });
			await writeFile(path.join(repoRoot, filePath), source);
		}
		try {
			const config = await eslint.calculateConfigForFile(filePath);
			expect(config?.rules?.[ruleId]?.[0]).toBe(2);
			const messages = await sliderMessages(source, filePath);
			expect(messages).toHaveLength(1);
			expect(messages[0].messageId).toBe('directSliderImport');
		} finally {
			if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
		}
	});

	it.each(prohibitedSliderBindings)('rejects %s', async (_label, source) => {
		const messages = await sliderMessages(source);
		expect(messages).toHaveLength(1);
		expect(messages[0].message).toBe(sliderMessage);
	});

	it.each(prohibitedBoundaries)('rejects %s', async (_label, source, site) => {
		const messages = await sliderMessages(source);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({
			message: boundaryMessage,
			column: boundaryColumn(source, site)
		});
	});

	it.each(latestProScenarios)(
		'rejects the latest Pro scenario: %s',
		async (_label, source, site, filePath) => {
			const messages = await sliderMessages(source, filePath);
			expect(messages).toHaveLength(1);
			expect(messages[0]).toMatchObject({
				message: boundaryMessage,
				column: boundaryColumn(source, site)
			});
		}
	);

	it.each(permitted)('allows %s', async (_label, source) => {
		expect(await sliderMessages(source)).toEqual([]);
	});

	it('exempts the shadcn UI wrapper implementation', async () => {
		const source =
			"<script>import { Slider } from 'bits-ui'; import * as Bits from 'bits-ui'; void import('bits-ui');</script>";
		expect(await sliderMessages(source, 'src/lib/components/ui/slider/slider.svelte')).toEqual([]);
	}, 60_000);

	it('exempts the absolute wrapper path when ESLint runs from src', async () => {
		const source =
			"<script>import { Slider } from 'bits-ui'; import * as Bits from 'bits-ui'; void import('bits-ui');</script>";
		const filePath = path.join(repoRoot, 'src/lib/components/ui/slider/slider.svelte');
		const [result] = await subdirectoryEslint.lintText(source, { filePath });
		expect(result.fatalErrorCount).toBe(0);
		expect(result.messages.filter((message) => message.ruleId === ruleId)).toEqual([]);
	}, 60_000);

	it('checks an absolute application lookalike path when ESLint runs from src', async () => {
		const filePath = path.join(repoRoot, 'src/features/payments/components/ui/controls.ts');
		const config = await subdirectoryEslint.calculateConfigForFile(filePath);
		expect(config?.rules?.[ruleId]?.[0]).toBe(2);
		const [result] = await subdirectoryEslint.lintText("import { Slider } from 'bits-ui';", {
			filePath
		});
		expect(result.fatalErrorCount).toBe(0);
		expect(result.messages.filter((message) => message.ruleId === ruleId)).toMatchObject([
			{ messageId: 'directSliderImport' }
		]);
	});
});
