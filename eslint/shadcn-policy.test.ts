// @vitest-environment node
import { existsSync } from 'node:fs';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { shadcnPolicy } from './shadcn-policy.js';

const eslint = new ESLint({ overrideConfig: [shadcnPolicy] });
const route = 'src/routes/+layout.svelte';
const helper = 'src/lib/utils.ts';
const button = `<script lang="ts">import { Button } from '$lib/components/ui/button';</script>\n`;
const fields = `<script lang="ts">
import * as Field from '$lib/components/ui/field';
import * as Card from '$lib/components/ui/card';
</script>\n`;

async function messages(source: string, filePath = route) {
	expect(existsSync(filePath)).toBe(true);
	expect(await eslint.isPathIgnored(filePath)).toBe(false);
	const [result] = await eslint.lintText(source, { filePath });
	expect(result.ignored).not.toBe(true);
	expect(result.fatalErrorCount).toBe(0);
	expect(result.messages.filter((message) => message.fatal)).toEqual([]);
	return result.messages.filter((message) => message.ruleId?.startsWith('shadcn/'));
}

function ids(result: Awaited<ReturnType<typeof messages>>) {
	return result.map((message) => message.ruleId);
}

describe('shadcn policy through the application ESLint config', () => {
	it('keeps the test path included and rejects an ignored scratch path', async () => {
		expect(await eslint.isPathIgnored(route)).toBe(false);
		expect(await eslint.isPathIgnored(helper)).toBe(false);
		expect(await eslint.isPathIgnored('scratch/shadcn-lint-migration/probe.svelte')).toBe(true);
	});

	it('checks imported Button markup through the safe Svelte parser', async () => {
		const source = `${button}<Button class="rounded-full">Save</Button>`;
		expect(ids(await messages(source))).toContain('shadcn/no-restyle');
		const withoutRule = new ESLint({
			overrideConfig: [
				{ ...shadcnPolicy, rules: { ...shadcnPolicy.rules, 'shadcn/no-restyle': 'off' } }
			]
		});
		const [disabled] = await withoutRule.lintText(source, { filePath: route });
		expect(disabled.fatalErrorCount).toBe(0);
		expect(ids(disabled.messages)).not.toContain('shadcn/no-restyle');
	}, 60_000);

	it('checks native styles, style directives, and unknown template classes', async () => {
		const found = await messages(
			'<div style="color: red" style:background-color="red" class="hovr:flex" />'
		);
		expect(ids(found)).toContain('shadcn/no-unknown-classes');
		expect(found.filter((message) => message.ruleId === 'shadcn/no-inline-styles')).toHaveLength(2);
	});

	it('rejects arbitrary layout values on a native element', async () => {
		const found = await messages('<div class="w-[550px]" />');
		const arbitrary = found.filter((message) => message.ruleId === 'shadcn/no-arbitrary-values');
		expect(arbitrary).toHaveLength(1);
		expect(arbitrary[0].severity).toBe(2);
		expect(arbitrary[0].message).toContain('w-[550px]');
	});

	it('checks script-module tv and TypeScript helper class strings', async () => {
		const module = `<script module lang="ts">
import { tv } from 'tailwind-variants';
export const style = tv({ base: 'bg-red-500' });
</script><div />`;
		expect(ids(await messages(module))).toContain('shadcn/no-raw-colors');
		expect(ids(await messages("export const classes = cn('bg-red-500');", helper))).toContain(
			'shadcn/no-raw-colors'
		);
	});

	it.each(['h-12', 'size-10', 'p-4', 'rounded-full'])(
		'rejects Button %s while admitting placement',
		async (className) => {
			const found = await messages(
				`${button}<Button class="${className} w-full mt-4">Save</Button>`
			);
			expect(found.filter((message) => message.ruleId === 'shadcn/no-restyle')).toHaveLength(1);
			expect(found.find((message) => message.ruleId === 'shadcn/no-restyle')?.message).toContain(
				`"${className}"`
			);
		}
	);

	it('requires readable classes on an imported Button', async () => {
		const source = `<script lang="ts">
import { Button } from '$lib/components/ui/button';
function getClasses(): string { return 'mt-4'; }
</script>
<Button class={getClasses()}>Save</Button>`;
		const found = await messages(source);
		const unreadable = found.filter(
			(message) => message.ruleId === 'shadcn/require-static-classes'
		);
		expect(unreadable).toHaveLength(1);
		expect(unreadable[0].severity).toBe(2);
		const withoutRule = new ESLint({
			overrideConfig: [
				{
					...shadcnPolicy,
					rules: { ...shadcnPolicy.rules, 'shadcn/require-static-classes': 'off' }
				}
			]
		});
		const [disabled] = await withoutRule.lintText(source, { filePath: route });
		expect(disabled.fatalErrorCount).toBe(0);
		expect(ids(disabled.messages)).not.toContain('shadcn/require-static-classes');
	});

	it('recognizes CardContent and allows only its approved spacing', async () => {
		const found = await messages(`${fields}<Card.Content class="p-4 bg-primary rounded-full" />`);
		const restyles = found.filter((message) => message.ruleId === 'shadcn/no-restyle');
		expect(restyles).toHaveLength(2);
		expect(restyles.every((message) => message.message.includes('CardContent'))).toBe(true);
		expect(restyles.map((message) => message.message).join(' ')).toContain('bg-primary');
		expect(restyles.map((message) => message.message).join(' ')).toContain('rounded-full');
		expect(restyles.map((message) => message.message).join(' ')).not.toContain('"p-4"');
	});

	it('rejects Field.Group spacing but accepts CardContent spacing', async () => {
		const found = await messages(
			`${fields}<Field.Group class="gap-1 p-4 m-2" /><Card.Content class="p-4" />`
		);
		const restyles = found.filter((message) => message.ruleId === 'shadcn/no-restyle');
		expect(restyles).toHaveLength(3);
		expect(restyles.every((message) => message.message.includes('FieldGroup'))).toBe(true);
	});
});
