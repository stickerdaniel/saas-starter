// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import spec from './__fixtures__/shadcn-restyle-spec.json';
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

// The expected policy is the committed decision, not the implementation under test, so
// a category or class added to shadcn-policy.js alone fails here.
type Contract = { pattern: string; allow: string[] };
type Owner = { id: string; files: string[]; components: Record<string, string[]> };
const specBase: { allow: string[]; contracts: Contract[] } = spec.base;
const specOwners: Owner[] = spec.owners;

// The decision's composition: every base contract in order, then one contract per owned
// component that unions the allowance it would otherwise inherit with the owner's classes.
function specOptionsFor(file: string) {
	const components = new Map<string, string[]>();
	for (const owner of specOwners.filter((owner) => owner.files.includes(file))) {
		for (const [name, additions] of Object.entries(owner.components)) {
			components.set(name, [...new Set([...(components.get(name) ?? []), ...additions])]);
		}
	}
	if (components.size === 0) return specBase;
	const inherited = (name: string) =>
		specBase.contracts.findLast((contract) => new RegExp(contract.pattern).test(name))?.allow ??
		specBase.allow;
	return {
		...specBase,
		contracts: [
			...specBase.contracts,
			...Array.from(components, ([name, additions]) => ({
				pattern: `^${name}$`,
				allow: [...new Set([...inherited(name), ...additions])]
			}))
		]
	};
}

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
			// A token may itself contain quotes, such as [&[aria-expanded="true"]]:bg-accent.
			const match = /^"(.+?)" is not allowed on <([^>]+)>/.exec(message.message);
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
		expect(await restyleOptionsFor(measurement, route)).toEqual([2, specBase]);
		// No container contract after STRICT may reopen a control.
		const strict = specBase.contracts.at(-1)!;
		for (const name of ['Button', 'Badge', 'AdminThreadRow']) {
			expect(specBase.contracts.filter((c) => new RegExp(c.pattern).test(name))).toEqual([strict]);
		}
	});

	it('composes the specified options at every owner file and nowhere else', async () => {
		const files = [...new Set(specOwners.flatMap((owner) => owner.files))];
		expect(files).toHaveLength(55);
		expect([...new Set(restyleOwners.flatMap((owner) => owner.files))].sort()).toEqual(
			[...files].sort()
		);
		for (const file of [...files, route]) {
			expect(existsSync(file), file).toBe(true);
			expect(await restyleOptionsFor(measurement, file), file).toEqual([2, specOptionsFor(file)]);
		}
	}, 120_000);

	it('repeats the base contracts in an owner file and unions the inherited allowance', async () => {
		const [severity, options] = await restyleOptionsFor(measurement, composer);
		expect(severity).toBe(2);
		expect(options.allow).toEqual(specBase.allow);
		expect(options.contracts.slice(0, -1)).toEqual(specBase.contracts);
		const owned = options.contracts.at(-1);
		const additions = specOwners.find((owner) => owner.id === 'O06')!.components.Textarea!;
		expect(owned.pattern).toBe('^Textarea$');
		expect(owned.allow).toEqual([...new Set([...specBase.contracts.at(-1)!.allow, ...additions])]);
	});

	it('keeps borders, rings and color off a Skeleton', async () => {
		const source = `<script lang="ts">import { Skeleton } from '$lib/components/ui/skeleton';</script>
<Skeleton class="rounded-full ring-2 border-4 bg-primary" />`;
		const found = await restyles(measurement, source, route);
		expect(found.map((entry) => entry.token).sort()).toEqual(['bg-primary', 'border-4', 'ring-2']);
	}, 60_000);

	it('rejects a class outside the O02 additions inside its owner file', async () => {
		const owner = specOwners.find((entry) => entry.id === 'O02')!;
		const source = `<script lang="ts">import { Button } from '$lib/components/ui/button';</script>
<Button class="${owner.components.Button!.join(' ')} bg-primary" />`;
		const found = await restyles(measurement, source, owner.files[0]!);
		expect(found.map((entry) => entry.token)).toEqual(['bg-primary']);
	}, 60_000);

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
			expect(await restyleOptionsFor(withAuthCard, nearMiss)).toEqual([2, specBase]);
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
	const ownedDir = 'src/lib/components/ui/owned';
	const owners = readdirSync(ownedDir)
		.filter((file) => file.endsWith('.svelte'))
		.map((file) => file.replace(/\.svelte$/, ''));
	const pascal = (file: string) =>
		file.replace(/(^|-)([a-z])/g, (_, __, letter: string) => letter.toUpperCase());

	// Every file in components/ui/owned is reported under its own name, so a new owner
	// that STRICT does not list would fall back to the layout default here.
	it('rejects appearance and admits placement at every caller', async () => {
		expect(owners).toHaveLength(16);
		const imports = owners
			.map((owner) => `import ${pascal(owner)} from '$lib/components/ui/owned/${owner}.svelte';`)
			.join('\n');
		const header = `<script lang="ts">\n${imports}\n</script>\n`;
		const firstLine = header.split('\n').length;
		const source =
			header + owners.map((owner) => `<${pascal(owner)} class="${classes}" />`).join('\n');
		const found = await restyles(measurement, source, route);

		owners.forEach((owner, index) => {
			const onLine = found.filter((entry) => entry.line === firstLine + index);
			expect(onLine.map((entry) => entry.component)).toEqual(appearance.map(() => pascal(owner)));
			expect(onLine.map((entry) => entry.token).sort(), owner).toEqual([...appearance].sort());
		});
		expect(found).toHaveLength(owners.length * appearance.length);
	}, 60_000);
});

describe('no-restyle owner profiles', () => {
	// How a fixture writes each owned component, with an import that resolves it to the
	// name the rule reports.
	const fixtures: Record<string, { from: string; tag: string }> = {
		Accordion: {
			from: 'import * as Accordion from "$lib/components/ui/accordion";',
			tag: 'Accordion.Root type="single"'
		},
		AccordionContent: {
			from: 'import * as Accordion from "$lib/components/ui/accordion";',
			tag: 'Accordion.Content'
		},
		AccordionItem: {
			from: 'import * as Accordion from "$lib/components/ui/accordion";',
			tag: 'Accordion.Item value="x"'
		},
		AccordionTrigger: {
			from: 'import * as Accordion from "$lib/components/ui/accordion";',
			tag: 'Accordion.Trigger'
		},
		AlertDialogAction: {
			from: 'import * as AlertDialog from "$lib/components/ui/alert-dialog";',
			tag: 'AlertDialog.Action'
		},
		Avatar: { from: 'import * as Avatar from "$lib/components/ui/avatar";', tag: 'Avatar.Root' },
		Badge: { from: 'import { Badge } from "$lib/components/ui/badge";', tag: 'Badge' },
		Button: { from: 'import { Button } from "$lib/components/ui/button";', tag: 'Button' },
		Card: { from: 'import * as Card from "$lib/components/ui/card";', tag: 'Card.Root' },
		CardDescription: {
			from: 'import * as Card from "$lib/components/ui/card";',
			tag: 'Card.Description'
		},
		CardFooter: { from: 'import * as Card from "$lib/components/ui/card";', tag: 'Card.Footer' },
		CardTitle: { from: 'import * as Card from "$lib/components/ui/card";', tag: 'Card.Title' },
		Collapsible: {
			from: 'import * as Collapsible from "$lib/components/ui/collapsible";',
			tag: 'Collapsible.Root'
		},
		CollapsibleContent: {
			from: 'import * as Collapsible from "$lib/components/ui/collapsible";',
			tag: 'Collapsible.Content'
		},
		Command: {
			from: 'import * as Command from "$lib/components/ui/command";',
			tag: 'Command.Root'
		},
		CommandEmpty: {
			from: 'import * as Command from "$lib/components/ui/command";',
			tag: 'Command.Empty'
		},
		CommandGroup: {
			from: 'import * as Command from "$lib/components/ui/command";',
			tag: 'Command.Group'
		},
		CommandItem: {
			from: 'import * as Command from "$lib/components/ui/command";',
			tag: 'Command.Item'
		},
		CopyButton: {
			from: 'import { CopyButton } from "$lib/components/ui/copy-button";',
			tag: 'CopyButton text="x"'
		},
		DialogContent: {
			from: 'import * as Dialog from "$lib/components/ui/dialog";',
			tag: 'Dialog.Content'
		},
		DropdownMenuContent: {
			from: 'import * as DropdownMenu from "$lib/components/ui/dropdown-menu";',
			tag: 'DropdownMenu.Content'
		},
		DropdownMenuItem: {
			from: 'import * as DropdownMenu from "$lib/components/ui/dropdown-menu";',
			tag: 'DropdownMenu.Item'
		},
		Empty: { from: 'import * as Empty from "$lib/components/ui/empty";', tag: 'Empty.Root' },
		Input: { from: 'import { Input } from "$lib/components/ui/input";', tag: 'Input' },
		InputGroup: {
			from: 'import * as InputGroup from "$lib/components/ui/input-group";',
			tag: 'InputGroup.Root'
		},
		Kbd: { from: 'import * as Kbd from "$lib/components/ui/kbd";', tag: 'Kbd.Root' },
		Label: { from: 'import { Label } from "$lib/components/ui/label";', tag: 'Label' },
		Progress: { from: 'import { Progress } from "$lib/components/ui/progress";', tag: 'Progress' },
		SelectTrigger: {
			from: 'import * as Select from "$lib/components/ui/select";',
			tag: 'Select.Trigger'
		},
		Separator: {
			from: 'import { Separator } from "$lib/components/ui/separator";',
			tag: 'Separator'
		},
		SheetContent: {
			from: 'import * as Sheet from "$lib/components/ui/sheet";',
			tag: 'Sheet.Content'
		},
		SidebarMenuAction: {
			from: 'import * as Sidebar from "$lib/components/ui/sidebar";',
			tag: 'Sidebar.MenuAction'
		},
		Textarea: { from: 'import { Textarea } from "$lib/components/ui/textarea";', tag: 'Textarea' },
		Toggle: { from: 'import { Toggle } from "$lib/components/ui/toggle";', tag: 'Toggle' }
	};

	// One element per owned component carrying the whole recipe, in a quote the recipe's
	// own attribute selectors do not use.
	function recipeSource(components: Record<string, string[]>) {
		const names = Object.keys(components);
		const imports = [...new Set(names.map((name) => fixtures[name].from))];
		const header = `<script lang="ts">\n${imports.join('\n')}\n</script>\n`;
		const firstLine = header.split('\n').length;
		const lines = names.map((name) => {
			const recipe = components[name].join(' ');
			const quote = recipe.includes('"') ? "'" : '"';
			expect(recipe.includes(quote), name).toBe(false);
			return `<${fixtures[name].tag} class=${quote}${recipe}${quote} />`;
		});
		return { source: header + lines.join('\n'), firstLine, names };
	}

	// Classes still reported inside an owner until a later migration step removes them:
	// ReasoningContent repeats AccordionContent's base type and focus reset, MessageAvatar
	// repeats Avatar's default size, and the PromptSuggestion pill utility replaced the
	// calc radius its profile names.
	const pending: Record<string, string[]> = {
		'src/lib/components/ai-elements/message/MessageAvatar.svelte': ['size-8@Avatar'],
		'src/lib/components/ai-elements/reasoning/ReasoningContent.svelte': [
			'text-sm@AccordionContent',
			'outline-none@AccordionContent'
		],
		'src/lib/components/prompt-kit/prompt-suggestion/prompt-suggestion.svelte': [
			'rounded-theme-pill@Button'
		]
	};

	it('keeps every owner file clean on the components it owns', async () => {
		const owned = new Map<string, Set<string>>();
		for (const owner of specOwners) {
			for (const file of owner.files) {
				const names = owned.get(file) ?? new Set<string>();
				for (const name of Object.keys(owner.components)) names.add(name);
				owned.set(file, names);
			}
		}
		// A private owner exists only for its recipe, so all of it must pass, and a
		// profile that names another file leaves the owner reported here.
		const ownedDir = 'src/lib/components/ui/owned';
		for (const file of readdirSync(ownedDir)) owned.set(`${ownedDir}/${file}`, new Set(['*']));

		for (const [file, names] of owned) {
			const found = await restyles(measurement, readFileSync(file, 'utf-8'), file);
			const reported = found
				.filter((entry) => names.has('*') || names.has(entry.component))
				.map((entry) => `${entry.token}@${entry.component}`);
			expect(
				reported.filter((token) => !pending[file]?.includes(token)),
				file
			).toEqual([]);
		}
	}, 180_000);

	it('names every owned component in a fixture', () => {
		const owned = new Set(specOwners.flatMap((owner) => Object.keys(owner.components)));
		expect([...owned].filter((name) => !fixtures[name])).toEqual([]);
	});

	for (const owner of specOwners) {
		it(`${owner.id} admits its recipe in its owner file only`, async () => {
			const { source, firstLine, names } = recipeSource(owner.components);
			for (const file of owner.files) {
				expect(await restyles(measurement, source, file), file).toEqual([]);
			}
			// Elsewhere every component keeps its strict or default contract, so each
			// recipe loses at least one class, and only classes from the recipe.
			const elsewhere = await restyles(measurement, source, route);
			names.forEach((name, index) => {
				const onLine = elsewhere.filter((entry) => entry.line === firstLine + index);
				expect(onLine.length, name).toBeGreaterThan(0);
				for (const entry of onLine) {
					expect(entry.component).toBe(name);
					expect(owner.components[name]).toContain(entry.token);
				}
			});
			expect(elsewhere.every((entry) => entry.line >= firstLine)).toBe(true);
		}, 60_000);
	}
});
