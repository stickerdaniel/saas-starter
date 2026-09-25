// @vitest-environment node
import { existsSync } from 'node:fs';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import safeSvelteParser from './parsers/safe-svelte-parser.js';
import { enforcedShadcnPolicy, shadcnPolicy } from './shadcn-policy.js';

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

describe('shadcn rules enforced by the application ESLint config', () => {
	const production = new ESLint();
	const enforced = [
		'shadcn/no-unknown-classes',
		'shadcn/require-static-classes',
		'shadcn/no-raw-colors',
		'shadcn/no-inline-styles',
		'shadcn/no-arbitrary-values'
	];
	const pending = ['shadcn/no-restyle'];
	const pendingSource = `${button}<Button class="rounded-full">Save</Button>`;

	async function productionMessages(source: string, filePath = route) {
		expect(await production.isPathIgnored(filePath)).toBe(false);
		const [result] = await production.lintText(source, { filePath });
		expect(result.ignored).not.toBe(true);
		expect(result.fatalErrorCount).toBe(0);
		return result.messages.filter((message) => message.ruleId?.startsWith('shadcn/'));
	}

	it('enables only the migrated rules, with the policy options, through the safe parser', async () => {
		expect(existsSync(route)).toBe(true);
		expect(await production.isPathIgnored(route)).toBe(false);
		const config = await production.calculateConfigForFile(route);
		// ESLint loads the config through its own module graph, so compare the parser by
		// behavior: only the safe wrapper rewrites a control character in a parse failure.
		expect(config.languageOptions.parser.meta).toEqual(safeSvelteParser.meta);
		const [invalid] = await production.lintText(`<div>{${String.fromCharCode(0x1b)}}</div>`, {
			filePath: route
		});
		expect(invalid.messages.find((message) => message.fatal)?.message).toContain('U+001B');
		expect(config.rules['shadcn/require-static-classes']).toEqual([2]);
		expect(config.rules['shadcn/no-raw-colors']).toEqual([2]);
		expect(config.rules['shadcn/no-inline-styles']).toEqual([2]);
		expect(config.rules['shadcn/no-unknown-classes']).toEqual([
			2,
			enforcedShadcnPolicy.rules['shadcn/no-unknown-classes'][1]
		]);
		expect(config.rules['shadcn/no-arbitrary-values']).toEqual([
			2,
			enforcedShadcnPolicy.rules['shadcn/no-arbitrary-values'][1]
		]);
		for (const rule of pending) expect(config.rules[rule]).toBeUndefined();
	}, 60_000);

	it('rejects a dynamic class on an imported Button', async () => {
		const found = await productionMessages(`<script lang="ts">
import { Button } from '$lib/components/ui/button';
function getClasses(): string { return 'mt-4'; }
</script>
<Button class={getClasses()}>Save</Button>`);
		expect(found.map((message) => [message.ruleId, message.severity])).toEqual([
			['shadcn/require-static-classes', 2]
		]);
	}, 60_000);

	it('rejects a misspelled variant', async () => {
		const found = await productionMessages('<div class="hovr:flex"></div>');
		expect(found.map((message) => [message.ruleId, message.severity])).toEqual([
			['shadcn/no-unknown-classes', 2]
		]);
		expect(found[0].message).toContain('hovr:flex');
	}, 60_000);

	it('admits allowed external classes by exact name only', async () => {
		expect(await productionMessages('<div class="not-prose toaster"></div>')).toEqual([]);
		const nearMisses = await productionMessages('<div class="not-proses toasters"></div>');
		expect(nearMisses.map((message) => message.ruleId)).toEqual([
			'shadcn/no-unknown-classes',
			'shadcn/no-unknown-classes'
		]);
	}, 60_000);

	it('rejects a raw palette color on a route', async () => {
		const found = await productionMessages('<div class="bg-red-500"></div>');
		expect(found.map((message) => [message.ruleId, message.severity])).toEqual([
			['shadcn/no-raw-colors', 2]
		]);
		expect(found[0].message).toContain('bg-red-500');
	}, 60_000);

	// TypeScript paths: the typed Svelte parser rejects a Svelte file that is not on disk.
	const exceptionSource = "export const classes = cn('bg-red-500 hovr:flex');";

	it.each(['src/lib/emails/x.ts', 'src/blocks/logos/x.ts'])(
		'admits raw colors under %s while other rules still apply',
		async (filePath) => {
			const found = await productionMessages(exceptionSource, filePath);
			expect(found.map((message) => [message.ruleId, message.severity])).toEqual([
				['shadcn/no-unknown-classes', 2]
			]);
		},
		60_000
	);

	it.each(['src/lib/emails-archive/x.ts', 'src/blocks/logos-extra/x.ts'])(
		'still rejects raw colors under the near-miss path %s',
		async (filePath) => {
			const found = await productionMessages(exceptionSource, filePath);
			expect(found.map((message) => message.ruleId).sort()).toEqual([
				'shadcn/no-raw-colors',
				'shadcn/no-unknown-classes'
			]);
		},
		60_000
	);

	// On-disk Svelte paths, because the typed Svelte parser rejects virtual ones.
	const svelteExceptionSource = '<div class="bg-red-500 hovr:flex"></div>';

	it.each([
		['src/lib/emails/components/layout/EmailFooter.svelte', ['shadcn/no-unknown-classes']],
		['src/blocks/logos/Convex.svelte', ['shadcn/no-unknown-classes']],
		['src/blocks/hero/hero-five.svelte', ['shadcn/no-raw-colors', 'shadcn/no-unknown-classes']]
	])(
		'applies the raw color exceptions to the Svelte file %s',
		async (filePath, expected) => {
			expect(existsSync(filePath)).toBe(true);
			const found = await productionMessages(svelteExceptionSource, filePath);
			expect(found.every((message) => message.severity === 2)).toBe(true);
			expect(found.map((message) => message.ruleId).sort()).toEqual(expected);
		},
		60_000
	);

	it.each([
		['src/lib/emails/nested/deep/x.svelte', 0],
		['src/blocks/logos/nested/x.svelte', 0],
		['src/blocks/hero/x.svelte', 2],
		['src/lib/emails-archive/x.svelte', 2],
		['src/blocks/logos-extra/x.svelte', 2]
	])('sets raw color severity for %s to %i', async (filePath, severity) => {
		expect(await production.isPathIgnored(filePath)).toBe(false);
		const config = await production.calculateConfigForFile(filePath);
		expect(config.rules['shadcn/no-raw-colors'][0]).toBe(severity);
	});

	it('rejects an inline style on a route', async () => {
		const found = await productionMessages('<div style="color: red"></div>');
		expect(found.map((message) => [message.ruleId, message.severity])).toEqual([
			['shadcn/no-inline-styles', 2]
		]);
		expect(found[0].message).toContain('color');
	}, 60_000);

	it('admits a runtime value passed through a custom property', async () => {
		expect(await productionMessages('<div class="w-(--x)" style:--x="4px"></div>')).toEqual([]);
	}, 60_000);

	it('rejects a raw color in a custom property', async () => {
		const found = await productionMessages('<div class="bg-(--c)" style:--c="#ec4899"></div>');
		expect(found.map((message) => [message.ruleId, message.severity])).toEqual([
			['shadcn/no-inline-styles', 2]
		]);
		expect(found[0].message).toContain('--c');
	}, 60_000);

	it('knows the inline-style replacement utilities from layout.css', async () => {
		expect(
			await productionMessages(
				'<div class="animation-delay-var scrollbar-stable rive-cloud-reveal sliding-header-mask"></div>'
			)
		).toEqual([]);
	}, 60_000);

	// Email clients need inline styles; brand logos get no such exception.
	it.each([
		['src/lib/emails/components/layout/EmailFooter.svelte', []],
		['src/blocks/logos/Convex.svelte', ['shadcn/no-inline-styles']]
	])(
		'applies the inline style exception to the Svelte file %s',
		async (filePath, expected) => {
			expect(existsSync(filePath)).toBe(true);
			const found = await productionMessages('<div style="color: red"></div>', filePath);
			expect(found.every((message) => message.severity === 2)).toBe(true);
			expect(found.map((message) => message.ruleId)).toEqual(expected);
		},
		60_000
	);

	it.each([
		['src/lib/emails/nested/deep/x.svelte', 0],
		['src/blocks/logos/nested/x.svelte', 2],
		['src/lib/emails-archive/x.svelte', 2]
	])('sets inline style severity for %s to %i', async (filePath, severity) => {
		expect(await production.isPathIgnored(filePath)).toBe(false);
		const config = await production.calculateConfigForFile(filePath);
		expect(config.rules['shadcn/no-inline-styles'][0]).toBe(severity);
	});

	it('rejects an arbitrary width on a route', async () => {
		const found = await productionMessages('<div class="w-[550px]"></div>');
		expect(found.map((message) => [message.ruleId, message.severity])).toEqual([
			['shadcn/no-arbitrary-values', 2]
		]);
		expect(found[0].message).toContain('w-[550px]');
	}, 60_000);

	it('admits an allowed arbitrary value by exact name only', async () => {
		expect(await productionMessages('<div class="h-[70vh] md:h-[70vh]"></div>')).toEqual([]);
		const nearMiss = await productionMessages('<div class="h-[71vh]"></div>');
		expect(nearMiss.map((message) => [message.ruleId, message.severity])).toEqual([
			['shadcn/no-arbitrary-values', 2]
		]);
		expect(nearMiss[0].message).toContain('h-[71vh]');
	}, 60_000);

	// The rule reads '*' as a wildcard and strips a leading '-' before matching, so these
	// shapes stay out of the allow list and their owners use named utilities.
	it.each([
		'rounded-[calc(9999px*sign(var(--radius)))]',
		'rounded-[calc(9999px*0*sign(var(--radius)))]',
		'md:rounded-[calc(9999px*0.001*sign(var(--radius)))]',
		'-translate-y-[calc(-50%+1px)]',
		'translate-y-[calc(-50%+1px)]',
		'data-[side=bottom]:translate-y-[calc(-50%+1px)]'
	])(
		'rejects the arbitrary radius and arrow offset %s',
		async (className) => {
			const found = await productionMessages(`<div class="${className}"></div>`);
			expect(found.map((message) => [message.ruleId, message.severity])).toEqual([
				['shadcn/no-arbitrary-values', 2]
			]);
			expect(found[0].message).toContain(className);
		},
		60_000
	);

	it('knows the arbitrary-value replacement tokens and utilities from layout.css', async () => {
		expect(
			await productionMessages(
				'<div class="text-2xs animate-loading-dots leading-composer transition-control-colors transition-field-colors auth-card-transition composer-scroll-mask sidebar-shortcut-mask thread-timestamp-mask marketing-footer-mask rounded-theme-pill tooltip-arrow-offset"></div>'
			)
		).toEqual([]);
	}, 60_000);

	it('admits the premium theme tokens', async () => {
		expect(
			await productionMessages('<div class="bg-premium/15 text-premium-foreground"></div>')
		).toEqual([]);
	}, 60_000);

	it('does not yet report the pending rules', async () => {
		const found = await productionMessages(pendingSource);
		expect(found.filter((message) => !enforced.includes(message.ruleId ?? ''))).toEqual([]);
		// The same source does trip every pending rule once the full policy is applied.
		expect(new Set(ids(await messages(pendingSource)))).toEqual(new Set(pending));
	}, 60_000);
});
