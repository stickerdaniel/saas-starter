// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ESLint } from 'eslint';
import * as svelteParser from 'svelte-eslint-parser';
import ts from 'typescript-eslint';
import { afterAll, describe, expect, it } from 'vitest';
import {
	enforcedShadcnPolicy,
	restyleEntries,
	restyleOptions,
	restyleOwners,
	shadcnPolicy
} from './shadcn-policy.js';

// Real files, because the typed Svelte parser rejects a Svelte path that is not on disk.
const route = 'src/routes/+layout.svelte';
const signin = 'src/routes/[[lang]]/(auth)/signin/+page.svelte';
const signup = 'src/routes/[[lang]]/(auth)/signup/+page.svelte';
const composer = 'src/lib/components/prompt-kit/prompt-input/PromptInputTextarea.svelte';

const measurement = new ESLint({ overrideConfig: shadcnPolicy });

type Found = { line: number; token: string; component: string };

async function restyles(
	eslint: ESLint,
	source: string,
	filePath: string,
	cwd = '.'
): Promise<Found[]> {
	expect(existsSync(path.resolve(cwd, filePath))).toBe(true);
	const [result] = await eslint.lintText(source, { filePath });
	expect(result.fatalErrorCount).toBe(0);
	return result.messages
		.filter((message) => message.ruleId === 'shadcn/no-restyle')
		.map((message) => {
			const match = /^"([^"]+)" is not allowed on <([^>]+)>/.exec(message.message);
			expect(match, message.message).not.toBeNull();
			return { line: message.line, token: match![1], component: match![2] };
		});
}

async function restyleOptionsFor(eslint: ESLint, filePath: string) {
	const config = await eslint.calculateConfigForFile(filePath);
	return config.rules['shadcn/no-restyle'];
}

// Appearance and internal geometry that no strict control accepts from a caller.
const appearance = ['bg-primary', 'p-4', 'h-12', 'rounded-full', 'text-lg', 'shadow-lg'];
// Placement that every strict control accepts, including negative and responsive forms.
const placementSample = ['-mt-2', 'w-full', 'shrink-0', 'relative', 'top-1', 'z-10', 'sm:hidden'];
const classes = [...appearance, ...placementSample].join(' ');

describe('no-restyle measurement options', () => {
	it('gives files without an owner profile the ordered base contracts', async () => {
		expect(await restyleOptionsFor(measurement, route)).toEqual([2, restyleOptions]);
		// No container contract after STRICT may reopen a control.
		const strict = restyleOptions.contracts.at(-1)!;
		for (const name of ['Button', 'Badge', 'AdminThreadRow']) {
			expect(restyleOptions.contracts.filter((c) => new RegExp(c.pattern).test(name))).toEqual([
				strict
			]);
		}
	});

	it('repeats the base contracts in an owner file and unions the inherited allowance', async () => {
		const [severity, options] = await restyleOptionsFor(measurement, composer);
		expect(severity).toBe(2);
		expect(options.allow).toEqual(restyleOptions.allow);
		expect(options.contracts.slice(0, -1)).toEqual(restyleOptions.contracts);
		const owned = options.contracts.at(-1);
		const additions = restyleOwners.find((owner) => owner.id === 'O06')!.components.Textarea;
		expect(owned.pattern).toBe('^Textarea$');
		expect(owned.allow).toEqual([
			...new Set([...restyleOptions.contracts.at(-1)!.allow, ...additions])
		]);
	});

	it('admits an owner recipe only in the owner file', async () => {
		const source = `<script lang="ts">import { Textarea } from '$lib/components/ui/textarea';</script>
<Textarea class="mt-2 composer-scroll-mask !py-0 bg-primary" />`;
		const inOwner = await restyles(measurement, source, composer);
		expect(inOwner.map((found) => found.token)).toEqual(['bg-primary']);
		const elsewhere = await restyles(measurement, source, route);
		expect(elsewhere.map((found) => found.token).sort()).toEqual(
			['!py-0', 'bg-primary', 'composer-scroll-mask'].sort()
		);
	}, 60_000);
});

describe('no-restyle flat-config precedence', () => {
	// The O48 auth card hook, attached to one literal [[lang]] route file.
	const authCard = {
		id: 'fixture',
		files: [signin],
		components: { Card: ['auth-card-transition'] }
	};
	const withAuthCard = new ESLint({
		overrideConfig: [enforcedShadcnPolicy, ...restyleEntries([authCard])]
	});
	const cardSource = `<script lang="ts">import * as Card from '$lib/components/ui/card';</script>
<Card.Root class="auth-card-transition p-4 bg-primary" />`;

	it('selects a [[lang]] route file literally rather than as a character class', async () => {
		const [, owned] = await restyleOptionsFor(withAuthCard, signin);
		expect(owned.contracts.at(-1)).toEqual({
			pattern: '^Card$',
			allow: ['layout', 'spacing', 'auth-card-transition']
		});
		// An unescaped [[lang]] glob matches this one-character directory instead.
		for (const nearMiss of ['src/routes/l]/(auth)/signin/+page.svelte', signup]) {
			expect(await restyleOptionsFor(withAuthCard, nearMiss)).toEqual([2, restyleOptions]);
		}
	});

	it('applies the owner allowance through the real route file only', async () => {
		const inOwner = await restyles(withAuthCard, cardSource, signin);
		expect(inOwner.map((found) => found.token)).toEqual(['bg-primary']);
		const inSibling = await restyles(withAuthCard, cardSource, signup);
		expect(inSibling.map((found) => found.token).sort()).toEqual(
			['auth-card-transition', 'bg-primary'].sort()
		);
	}, 60_000);

	it('replaces earlier contracts with the last match, so owners must repeat placement', async () => {
		const source = `<script lang="ts">import { Button } from '$lib/components/ui/button';</script>
<Button class="mt-4 bg-muted" />`;
		const replaced = new ESLint({
			overrideConfig: [
				enforcedShadcnPolicy,
				{
					files: ['src/**/*.svelte'],
					rules: {
						'shadcn/no-restyle': [
							'error',
							{
								...restyleOptions,
								contracts: [
									...restyleOptions.contracts,
									{ pattern: '^Button$', allow: ['bg-muted'] }
								]
							}
						]
					}
				}
			]
		});
		expect((await restyles(replaced, source, route)).map((found) => found.token)).toEqual(['mt-4']);

		const owner = new ESLint({
			overrideConfig: [
				enforcedShadcnPolicy,
				...restyleEntries([{ id: 'fixture', files: [route], components: { Button: ['bg-muted'] } }])
			]
		});
		expect(await restyles(owner, source, route)).toEqual([]);
		expect((await restyles(owner, source, signin)).map((found) => found.token)).toEqual([
			'bg-muted'
		]);
	}, 60_000);

	it('merges two profiles that own the same file instead of letting one overwrite the other', async () => {
		const merged = new ESLint({
			overrideConfig: [
				enforcedShadcnPolicy,
				...restyleEntries([
					{ id: 'a', files: [route], components: { Button: ['bg-muted'], Badge: ['text-2xs'] } },
					{ id: 'b', files: [route], components: { Button: ['p-4'] } }
				])
			]
		});
		const [, options] = await restyleOptionsFor(merged, route);
		const owned = options.contracts.slice(restyleOptions.contracts.length);
		expect(owned.map((contract: { pattern: string }) => contract.pattern)).toEqual([
			'^Button$',
			'^Badge$'
		]);
		expect(owned[0].allow.slice(-2)).toEqual(['bg-muted', 'p-4']);
	});
});

describe('no-restyle strict controls', () => {
	it('rejects appearance and admits placement on every public control', async () => {
		const controls = [
			['Button', '<Button class="CLASSES" />'],
			['CopyButton', '<CopyButton text="x" class="CLASSES" />'],
			['ScrollButton', '<ScrollButton class="CLASSES" />'],
			['PromptSuggestion', '<PromptSuggestion class="CLASSES">x</PromptSuggestion>'],
			['CommandTrigger', '<CommandTrigger class="CLASSES" />'],
			['NavigationButton', '<NavigationButton type="back" class="CLASSES" />'],
			['AlertDialogAction', '<AlertDialog.Action class="CLASSES" />'],
			['AlertDialogCancel', '<AlertDialog.Cancel class="CLASSES" />'],
			['InputGroupButton', '<InputGroup.Button class="CLASSES" />'],
			['Badge', '<Badge class="CLASSES" />'],
			['Input', '<Input class="CLASSES" />'],
			['SidebarInput', '<Sidebar.Input class="CLASSES" />'],
			['InputGroupInput', '<InputGroup.Input class="CLASSES" />'],
			['Textarea', '<Textarea class="CLASSES" />'],
			['InputGroupTextarea', '<InputGroup.Textarea class="CLASSES" />'],
			['PromptInputTextarea', '<PromptInputTextarea class="CLASSES" />'],
			['SelectTrigger', '<Select.Trigger class="CLASSES" />'],
			['TabsTrigger', '<Tabs.Trigger value="x" class="CLASSES" />'],
			['Toggle', '<Toggle class="CLASSES" />'],
			['Avatar', '<Avatar.Root class="CLASSES" />'],
			['AvatarImage', '<Avatar.Image class="CLASSES" />'],
			['AvatarFallback', '<Avatar.Fallback class="CLASSES" />'],
			['Kbd', '<Kbd.Root class="CLASSES" />'],
			['KbdGroup', '<Kbd.Group class="CLASSES" />']
		] as const;
		const imports = `<script lang="ts">
import { Button } from '$lib/components/ui/button';
import { CopyButton } from '$lib/components/ui/copy-button';
import ScrollButton from '$lib/components/prompt-kit/scroll-button/ScrollButton.svelte';
import PromptInputTextarea from '$lib/components/prompt-kit/prompt-input/PromptInputTextarea.svelte';
import PromptSuggestion from '$lib/components/prompt-kit/prompt-suggestion/prompt-suggestion.svelte';
import CommandTrigger from '$lib/components/global-search/command-trigger.svelte';
import NavigationButton from '$lib/components/customer-support/navigation-button.svelte';
import * as AlertDialog from '$lib/components/ui/alert-dialog';
import * as InputGroup from '$lib/components/ui/input-group';
import { Badge } from '$lib/components/ui/badge';
import { Input } from '$lib/components/ui/input';
import * as Sidebar from '$lib/components/ui/sidebar';
import { Textarea } from '$lib/components/ui/textarea';
import * as Select from '$lib/components/ui/select';
import * as Tabs from '$lib/components/ui/tabs';
import { Toggle } from '$lib/components/ui/toggle';
import * as Avatar from '$lib/components/ui/avatar';
import * as Kbd from '$lib/components/ui/kbd';
</script>
`;
		const firstLine = imports.split('\n').length;
		const source =
			imports + controls.map(([, markup]) => markup.replace('CLASSES', classes)).join('\n');
		const found = await restyles(measurement, source, route);

		controls.forEach(([name], index) => {
			const onLine = found.filter((entry) => entry.line === firstLine + index);
			expect(onLine.map((entry) => entry.token).sort(), name).toEqual([...appearance].sort());
		});
		expect(found).toHaveLength(controls.length * appearance.length);
	}, 60_000);
});

describe('no-restyle private owners', () => {
	const owners = [
		'admin-thread-row',
		'attachment-remove-button',
		'chatbar-send-button',
		'composer-attachment-button',
		'filter-chip-remove-button',
		'founder-body-preview-button',
		'founder-reset-confirm-action',
		'hero-five-cta',
		'integration-learn-more-button',
		'marketing-wordmark',
		'nav-user-trigger',
		'passkey-delete-button',
		'screenshot-submit-button',
		'sidebar-header-button',
		'support-thread-row',
		'user-ban-menu-item'
	];
	const pascal = (file: string) =>
		file.replace(/(^|-)([a-z])/g, (_, __, letter: string) => letter.toUpperCase());

	// The owners arrive with their migration, so a throwaway project registers them the
	// way components/ui/owned will: files under the project's ui directory.
	const project = mkdtempSync(path.join(tmpdir(), 'restyle-owners-'));
	afterAll(() => rmSync(project, { recursive: true, force: true }));
	writeFileSync(
		path.join(project, 'package.json'),
		'{ "name": "restyle-owners", "type": "module" }'
	);
	mkdirSync(path.join(project, 'src/components/ui/owned'), { recursive: true });
	mkdirSync(path.join(project, 'src/routes'), { recursive: true });
	for (const owner of owners) {
		writeFileSync(
			path.join(project, 'src/components/ui/owned', `${owner}.svelte`),
			'<script lang="ts">let { class: className }: { class?: string } = $props();</script>\n<button class={className}>x</button>\n'
		);
	}
	writeFileSync(path.join(project, 'src/routes/caller.svelte'), '');

	const eslint = new ESLint({
		cwd: project,
		overrideConfigFile: true,
		overrideConfig: [
			{
				files: ['**/*.svelte'],
				languageOptions: { parser: svelteParser, parserOptions: { parser: ts.parser } }
			},
			...restyleEntries()
		]
	});

	it('rejects appearance and admits placement at every caller', async () => {
		const imports = owners
			.map((owner) => `import ${pascal(owner)} from '../components/ui/owned/${owner}.svelte';`)
			.join('\n');
		const header = `<script lang="ts">\n${imports}\n</script>\n`;
		const firstLine = header.split('\n').length;
		const source =
			header + owners.map((owner) => `<${pascal(owner)} class="${classes}" />`).join('\n');
		const found = await restyles(eslint, source, 'src/routes/caller.svelte', project);

		owners.forEach((owner, index) => {
			const onLine = found.filter((entry) => entry.line === firstLine + index);
			expect(onLine.map((entry) => entry.component)).toEqual(appearance.map(() => pascal(owner)));
			expect(onLine.map((entry) => entry.token).sort(), owner).toEqual([...appearance].sort());
		});
		expect(found).toHaveLength(owners.length * appearance.length);
	}, 60_000);
});
