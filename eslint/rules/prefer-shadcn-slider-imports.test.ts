// @vitest-environment node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const eslint = new ESLint({ cwd: repoRoot });
const ruleId = 'local/prefer-shadcn-slider-imports';

async function sliderMessages(source: string, filePath = 'src/lib/analytics/posthog.ts') {
	const [result] = await eslint.lintText(source, { filePath });
	expect(result.fatalErrorCount).toBe(0);
	return result.messages.filter((message) => message.ruleId === ruleId);
}

const prohibited = [
	['named import', "import { Slider } from 'bits-ui'; void Slider;"],
	['aliased import', "import { Slider as RangeControl } from 'bits-ui'; void RangeControl;"],
	[
		'string-literal named import',
		"import { 'Slider' as RangeControl } from 'bits-ui'; void RangeControl;"
	],
	['direct re-export', "export { Slider } from 'bits-ui';"],
	['aliased direct re-export', "export { Slider as RangeControl } from 'bits-ui';"],
	['string-literal direct re-export', "export { 'Slider' as RangeControl } from 'bits-ui';"],
	['wildcard direct re-export', "export * from 'bits-ui';"],
	['namespace member access', "import * as Bits from 'bits-ui'; void Bits.Slider;"],
	['namespace computed access', "import * as Bits from 'bits-ui'; void Bits['Slider'];"],
	[
		'namespace destructuring',
		"import * as Bits from 'bits-ui'; const { Slider: RangeControl } = Bits; void RangeControl;"
	],
	[
		'dynamic member access',
		"const RangeControl = (await import('bits-ui')).Slider; void RangeControl;"
	],
	[
		'dynamic destructuring',
		"const { Slider: RangeControl } = await import('bits-ui'); void RangeControl;"
	],
	[
		'dynamic namespace member access',
		"const Bits = await import('bits-ui'); const RangeControl = Bits.Slider; void RangeControl;"
	],
	[
		'dynamic then destructuring',
		"await import('bits-ui').then(({ Slider: RangeControl }) => RangeControl);"
	],
	['dynamic then namespace access', "await import('bits-ui').then((Bits) => Bits.Slider);"],
	[
		'namespace alias',
		"import * as Bits from 'bits-ui'; const primitives = Bits; void primitives.Slider;"
	],
	[
		'use-before-import namespace alias',
		"void primitives.Slider; const primitives = Bits; import * as Bits from 'bits-ui';"
	],
	[
		'saved dynamic import then destructuring',
		"const bitsPromise = import('bits-ui'); await bitsPromise.then(({ Slider }) => Slider);"
	],
	[
		'saved dynamic import then namespace access',
		"const bitsPromise = import('bits-ui'); await bitsPromise.then((Bits) => Bits.Slider);"
	],
	[
		'static computed namespace access',
		"import * as Bits from 'bits-ui'; const key = 'Slider'; void Bits[key];"
	],
	[
		'static computed namespace destructuring',
		"import * as Bits from 'bits-ui'; const key = 'Slider'; const { [key]: RangeControl } = Bits; void RangeControl;"
	]
] as const;

const permitted = [
	['type-only declaration', "import type { Slider } from 'bits-ui'; type RangeControl = Slider;"],
	[
		'type-only specifier',
		"import { type Slider, Button } from 'bits-ui'; type RangeControl = Slider; void Button;"
	],
	['type-only re-export', "export type { Slider } from 'bits-ui';"],
	['type-only wildcard re-export', "export type * from 'bits-ui';"],
	['other namespace member', "import * as Bits from 'bits-ui'; void Bits.Button;"],
	[
		'other namespace destructuring',
		"import * as Bits from 'bits-ui'; const { Button } = Bits; void Button;"
	],
	['other dynamic member', "const Button = (await import('bits-ui')).Button; void Button;"],
	['other dynamic destructuring', "const { Button } = await import('bits-ui'); void Button;"],
	[
		'other dynamic namespace member',
		"const Bits = await import('bits-ui'); const Button = Bits.Button; void Button;"
	],
	['other dynamic then member', "await import('bits-ui').then((Bits) => Bits.Button);"],
	[
		'other namespace alias member',
		"import * as Bits from 'bits-ui'; const primitives = Bits; void primitives.Button;"
	],
	[
		'computed alias for another primitive',
		"import * as Bits from 'bits-ui'; const Slider = 'Button'; void Bits[Slider];"
	],
	[
		'computed destructuring alias for another primitive',
		"import * as Bits from 'bits-ui'; const Slider = 'Button'; const { [Slider]: Button } = Bits; void Button;"
	],
	[
		'mutable computed key',
		"import * as Bits from 'bits-ui'; let key = 'Slider'; key = 'Button'; void Bits[key];"
	],
	[
		'shadowed namespace alias',
		"import * as Bits from 'bits-ui'; { const Bits = { Slider: 1 }; void Bits.Slider; }"
	],
	[
		'nonliteral dynamic source',
		"const source = 'bits-ui'; const { Slider } = await import(source); void Slider;"
	],
	['wrapper import', "import { Slider } from '$lib/components/ui/slider/index.js'; void Slider;"]
] as const;

describe('prefer-shadcn-slider-imports production configuration', () => {
	it.each([
		[
			'TypeScript',
			'src/lib/analytics/posthog.ts',
			"import { Slider } from 'bits-ui'; void Slider;"
		],
		['JavaScript', 'src/lib/security/csp.js', "import { Slider } from 'bits-ui'; void Slider;"],
		[
			'Svelte module',
			'src/lib/chat/core/chat-core.svelte.ts',
			"import { Slider } from 'bits-ui'; void Slider;"
		],
		[
			'Svelte component',
			'src/lib/components/authenticated/authenticated-sidebar.svelte',
			"<script>import { Slider } from 'bits-ui'; void Slider;</script>"
		]
	] as const)(
		'rejects Slider in %s files',
		async (_label, filePath, source) => {
			expect(existsSync(path.join(repoRoot, filePath))).toBe(true);
			const config = await eslint.calculateConfigForFile(filePath);
			expect(config?.rules?.[ruleId]?.[0]).toBe(2);
			if (!filePath.endsWith('.svelte')) {
				expect(config?.rules?.['local/prefer-shadcn-primitives']).toBeUndefined();
			}
			expect(await sliderMessages(source, filePath)).toHaveLength(1);
		},
		60_000
	);

	it('rejects a Slider namespace component tag', async () => {
		const source = "<script>import * as Bits from 'bits-ui';</script><Bits.Slider.Root />";
		expect(
			await sliderMessages(source, 'src/lib/components/authenticated/authenticated-sidebar.svelte')
		).toHaveLength(1);
	});

	it('allows another primitive namespace component tag', async () => {
		const source = "<script>import * as Bits from 'bits-ui';</script><Bits.Button.Root />";
		expect(
			await sliderMessages(source, 'src/lib/components/authenticated/authenticated-sidebar.svelte')
		).toEqual([]);
	});

	it.each(prohibited)('rejects %s', async (_label, source) => {
		const messages = await sliderMessages(source);
		expect(messages).toHaveLength(1);
		expect(messages[0].message).toBe(
			'Import Slider from $lib/components/ui/slider/index.js instead of bits-ui.'
		);
	});

	it.each(permitted)('allows %s', async (_label, source) => {
		expect(await sliderMessages(source)).toEqual([]);
	});

	it('exempts the Slider wrapper implementation', async () => {
		const filePath = 'src/lib/components/ui/slider/slider.svelte';
		const source = "<script>import { Slider } from 'bits-ui'; void Slider;</script>";
		expect(await sliderMessages(source, filePath)).toEqual([]);
	}, 60_000);
});
