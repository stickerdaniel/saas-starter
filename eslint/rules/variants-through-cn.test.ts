// @vitest-environment node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { withoutTypeInformation } from '../without-type-information';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const eslint = new ESLint({ cwd: repoRoot, overrideConfig: withoutTypeInformation });
const ruleId = 'local/variants-through-cn';

async function reportedLines(source: string, filePath: string) {
	const [result] = await eslint.lintText(source, { filePath });
	expect(result.fatalErrorCount).toBe(0);
	return result.messages.filter((message) => message.ruleId === ruleId).map(({ line }) => line);
}

const svelteFile = 'src/lib/components/licenses/third-party-licenses.svelte';
const tsFile = 'src/lib/components/ui/badge/variants-probe.ts';

const button = "import { buttonVariants } from '#lib/components/ui/button/index.js';";
const ui = "import * as ui from '#lib/components/ui/button/index.js';";
const cn = "import { cn } from '#lib/utils.js';";
const tv = "import { tv } from 'tailwind-variants';";

function svelte(markup: string) {
	return `<script lang="ts">${button} ${cn} ${ui}</script>\n${markup}\n`;
}

describe('variants-through-cn in Svelte markup', () => {
	it.each([
		['a class attribute', '<a class={buttonVariants({ variant: "outline" })}>x</a>'],
		['a caller class slot', '<a class={buttonVariants({ class: "shrink-0" })}>x</a>'],
		['a template string', '<a class={`${buttonVariants()} shrink-0`}>x</a>'],
		['a nested call', '<a class={cn(String(buttonVariants()))}>x</a>'],
		['a spread class property', '<a {...{ class: buttonVariants() }}>x</a>'],
		['a namespace member', '<a class={ui.buttonVariants()}>x</a>']
	])('reports a variants result in %s', async (_, markup) => {
		expect(await reportedLines(svelte(markup), svelteFile)).toEqual([2]);
	});

	it.each([
		['a cn() argument', '<a class={cn(buttonVariants({ variant: "ghost" }), "shrink-0")}>x</a>'],
		['a spread class property', '<a {...{ class: cn(buttonVariants()) }}>x</a>'],
		['a namespace member in cn()', '<a class={cn(ui.buttonVariants())}>x</a>'],
		['a namespace component', '<ui.Root>x</ui.Root>'],
		[
			'a multiline cn() argument',
			'<a\n\tclass={cn(\n\t\t"shrink-0",\n\t\tbuttonVariants({\n\t\t\tvariant: "ghost"\n\t\t})\n\t)}\n>x</a>'
		]
	])('allows %s', async (_, markup) => {
		expect(await reportedLines(svelte(markup), svelteFile)).toEqual([]);
	});
});

describe('variants-through-cn in TypeScript', () => {
	it.each([
		[
			'a local tv() binding of any name',
			`${tv}\nconst indicator = tv({ base: 'p-2' });\nindicator();`,
			[3]
		],
		[
			'an aliased tv import',
			`import { tv as make } from 'tailwind-variants';\nconst look = make({});\nlook();`,
			[3]
		],
		[
			'a namespaced factory',
			`import * as variants from 'tailwind-variants';\nconst look = variants.tv({});\nlook();`,
			[3]
		],
		['an alias of the tv factory', `${tv}\nconst make = tv;\nvoid make;`, [2]],
		[
			'a renamed helper import',
			`import { buttonVariants as b } from '#lib/components/ui/button/index.js';\nb();`,
			[2]
		],
		['an alias of an imported helper', `${button}\nconst alias = buttonVariants;\nalias();`, [2]],
		[
			'an alias of a local tv() binding',
			`${tv}\nconst look = tv({});\nconst alias = look;\nalias();`,
			[3]
		],
		['a helper passed as a value', `${button}\n[1].map(buttonVariants);`, [2]],
		['a namespace destructured', `${ui}\nconst { buttonVariants: b } = ui;\nb();`, [2]],
		[
			'a namespace destructured by a quoted key',
			`${ui}\nconst { 'buttonVariants': b } = ui;\nb();`,
			[2]
		],
		[
			'a relative namespace member',
			`import * as Button from '../button/index.js';\nButton.buttonVariants();`,
			[2]
		],
		[
			'a computed namespace key',
			`${ui}\nconst key = 'buttonVariants';\nexport const x = ui[key];`,
			[3]
		],
		['a literal computed namespace key', `${ui}\nui['buttonVariants']();`, [2]],
		['a namespace passed on', `${ui}\nexport const all = Object.values(ui);`, [2]],
		[
			'a destructured tv() result',
			`${tv}\nconst { base } = tv({ slots: { base: 'p-2' } });\nvoid base;`,
			[2]
		],
		[
			'a call before the declaration',
			`${tv}\nfunction render() {\n\treturn look();\n}\nconst look = tv({});\nvoid render;`,
			[3]
		],
		[
			'a local function named cn',
			`${button}\nconst cn = (value: string) => value;\ncn(buttonVariants());`,
			[3]
		],
		['a relative utils cn', `${button}\nimport { cn } from './utils';\ncn(buttonVariants());`, [3]],
		[
			'an unrelated utils cn',
			`${button}\nimport { cn } from 'unrelated/lib/utils';\ncn(buttonVariants());`,
			[3]
		]
	] as const)('reports %s', async (_, source, lines) => {
		expect(await reportedLines(source, tsFile)).toEqual(lines);
	});

	it.each([
		['a local tv() binding in cn()', `${tv}\n${cn}\nconst look = tv({});\ncn(look(), 'p-4');`],
		[
			'a call before the declaration in cn()',
			`${tv}\n${cn}\nconst render = () => cn(look());\nconst look = tv({});\nvoid render;`
		],
		['a namespace member in cn()', `${ui}\n${cn}\ncn(ui.buttonVariants());`],
		[
			'a relative namespace member in cn()',
			`import * as Button from '../button/index.js';\n${cn}\ncn(Button.buttonVariants());`
		],
		[
			'a relative namespace outside ui modules',
			`import * as data from '../../../data.js';\nexport const all = Object.values(data);`
		],
		['a re-export', `${button}\nexport { buttonVariants };`],
		[
			'a type query',
			`import type { VariantProps } from 'tailwind-variants';\n${button}\nexport type P = VariantProps<typeof buttonVariants>;`
		],
		[
			'an unrelated object method',
			`const service = { listVariants: () => ['a'] };\nexport const list = service.listVariants();`
		],
		[
			'a parameter shadowing the namespace',
			`${ui}\nexport const f = (ui: { buttonVariants: () => string }) => ui.buttonVariants();`
		],
		[
			'a function named like a helper but not imported',
			`const fooVariants = () => 'p-2';\nfooVariants();`
		]
	] as const)('allows %s', async (_, source) => {
		expect(await reportedLines(source, tsFile)).toEqual([]);
	});
});
