<script lang="ts">
	import { T, getTranslate } from '@tolgee/svelte';
	import BoldIcon from '@lucide/svelte/icons/bold';
	import BracesIcon from '@lucide/svelte/icons/braces';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import LinkIcon from '@lucide/svelte/icons/link';
	import ListIcon from '@lucide/svelte/icons/list';
	import ListOrderedIcon from '@lucide/svelte/icons/list-ordered';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import * as Kbd from '#lib/components/ui/kbd/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { TemplateTextarea } from '#lib/components/ui/template-textarea/index.js';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { cmdOrCtrl } from '#lib/hooks/is-mac.svelte.ts';
	import {
		FOUNDER_TEMPLATE_VARIABLES,
		renderFounderEmail,
		type FounderTemplateVariables
	} from '#lib/convex/emails/founderTemplate.js';
	import {
		bodyFormats,
		continueList,
		insertVariable,
		pasteLink,
		removeListMarker,
		toggleBold,
		toggleLink,
		toggleList,
		type BodyEdit,
		type BodySelection,
		type ListKind
	} from './founder-body-edits.js';

	let {
		id,
		value = $bindable(''),
		previewVars
	}: { id: string; value?: string; previewVars: FounderTemplateVariables } = $props();

	const { t } = getTranslate();

	let tab = $state('write');
	let textarea = $state<HTMLTextAreaElement | null>(null);

	// Links open in a new tab so following one does not leave the unsaved dialog.
	const previewHtml = $derived(
		renderFounderEmail(value, previewVars).html.replaceAll(
			'<a href=',
			'<a target="_blank" rel="noopener noreferrer" href='
		)
	);

	const variableLabelKeys = {
		userFirstName: 'admin.settings.founder_welcome.variable_first_name',
		userLastName: 'admin.settings.founder_welcome.variable_last_name',
		founderName: 'admin.settings.founder_welcome.variable_founder_name',
		founderTitle: 'admin.settings.founder_welcome.variable_founder_title'
	} satisfies Record<keyof FounderTemplateVariables, string>;

	type Tool<Id extends string> = {
		id: Id;
		labelKey: string;
		/** The `key` (or, with Shift, the `code`) that runs the tool with Cmd or Ctrl. */
		shortcut: string;
		keys: string[];
		icon: typeof BoldIcon;
		edit: (selection: BodySelection) => BodyEdit | undefined;
	};

	const formatTools: Array<Tool<'bold' | 'link'>> = [
		{
			id: 'bold',
			labelKey: 'admin.settings.founder_welcome.editor_bold',
			shortcut: 'b',
			keys: [cmdOrCtrl, 'B'],
			icon: BoldIcon,
			edit: toggleBold
		},
		{
			id: 'link',
			labelKey: 'admin.settings.founder_welcome.editor_link',
			shortcut: 'k',
			keys: [cmdOrCtrl, 'K'],
			icon: LinkIcon,
			edit: toggleLink
		}
	];

	const listTools: Array<Tool<ListKind>> = [
		{
			id: 'bulleted',
			labelKey: 'admin.settings.founder_welcome.editor_bulleted_list',
			shortcut: 'Digit8',
			keys: [cmdOrCtrl, '⇧', '8'],
			icon: ListIcon,
			edit: (selection) => toggleList(selection, 'bulleted')
		},
		{
			id: 'numbered',
			labelKey: 'admin.settings.founder_welcome.editor_numbered_list',
			shortcut: 'Digit7',
			keys: [cmdOrCtrl, '⇧', '7'],
			icon: ListOrderedIcon,
			edit: (selection) => toggleList(selection, 'numbered')
		}
	];

	const tools: Array<Tool<string>> = [...formatTools, ...listTools];

	// The textarea reports every caret move, so the toggles follow the selection.
	let range = $state({ start: 0, end: 0 });
	const body = $derived<BodySelection>({ value, ...range });
	const formats = $derived(bodyFormats(body));
	const usable = $derived(new Set(tools.filter((tool) => tool.edit(body)).map((tool) => tool.id)));

	function syncRange() {
		if (textarea) range = { start: textarea.selectionStart, end: textarea.selectionEnd };
	}

	/** Run the tool whose toggle a click or key turned on or off. */
	function setFormats(next: string[]) {
		const tool = formatTools.find(
			(candidate) => next.includes(candidate.id) !== formats[candidate.id]
		);
		if (tool) run(tool);
	}

	function setList(next: string) {
		// An empty value turns the active list off, which its own tool does.
		const tool = listTools.find((candidate) => candidate.id === (next || formats.list));
		if (tool) run(tool);
	}

	function selection(): BodySelection | undefined {
		if (!textarea) return undefined;
		return { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd };
	}

	/** Apply an edit through the undo stack, then select its result. */
	function apply(edit: BodyEdit | undefined) {
		if (!edit || !textarea) return;
		textarea.focus();
		// Moving the caret first ends the browser's typing undo step, so undo reverts
		// this edit alone rather than the text typed just before it.
		const nudge = edit.from > 0 ? edit.from - 1 : Math.min(1, textarea.value.length);
		textarea.setSelectionRange(nudge, nudge);
		textarea.setSelectionRange(edit.from, edit.to);
		// An edit that only moves the caret changes no text.
		if (edit.text !== '' || edit.from !== edit.to) {
			// Both commands keep the edit undoable. WebKit's insertText of nothing also
			// deletes the line break before the selection, so deletions use delete.
			const done = edit.text
				? document.execCommand?.('insertText', false, edit.text)
				: document.execCommand?.('delete');
			// setRangeText covers engines without execCommand.
			if (!done) {
				textarea.setRangeText(edit.text, edit.from, edit.to, 'end');
				textarea.dispatchEvent(new Event('input', { bubbles: true }));
			}
		}
		textarea.setSelectionRange(...edit.select);
		syncRange();
	}

	function run(tool: Tool<string>) {
		const current = selection();
		if (current) apply(tool.edit(current));
	}

	function handleKeydown(event: KeyboardEvent) {
		// Safari ends an IME composition with a keydown that only keyCode 229 marks.
		if (event.isComposing || event.keyCode === 229) return;
		const modified = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
		if (!modified && (event.key === 'Enter' || event.key === 'Backspace')) {
			const current = selection();
			const edit =
				current && (event.key === 'Enter' ? continueList(current) : removeListMarker(current));
			if (!edit) return;
			event.preventDefault();
			apply(edit);
			return;
		}
		if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
		const key = event.shiftKey ? event.code : event.key.toLowerCase();
		const tool = tools.find((candidate) => candidate.shortcut === key);
		if (!tool) return;
		event.preventDefault();
		// The app shell binds Cmd+B to its sidebar; the editor keeps its shortcuts.
		event.stopPropagation();
		run(tool);
	}

	function handlePaste(event: ClipboardEvent) {
		const current = selection();
		const edit = current && pasteLink(current, event.clipboardData?.getData('text/plain') ?? '');
		if (!edit) return;
		event.preventDefault();
		apply(edit);
	}

	// Toolbar buttons keep the textarea focused, so its selection stays visible.
	const keepFocus = (event: MouseEvent) => event.preventDefault();
</script>

{#snippet toggle(tool: Tool<string>)}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<ToggleGroup.Item
					{...props}
					value={tool.id}
					aria-label={$t(tool.labelKey)}
					disabled={!usable.has(tool.id)}
					onmousedown={keepFocus}
				>
					<tool.icon />
				</ToggleGroup.Item>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content>
			{$t(tool.labelKey)}
			<Kbd.Group>
				{#each tool.keys as key (key)}
					<Kbd.Root>{key}</Kbd.Root>
				{/each}
			</Kbd.Group>
		</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

<Tabs.Root bind:value={tab}>
	<InputGroup.Root>
		<InputGroup.Addon align="block-start" class="flex-wrap">
			<Tabs.List>
				<Tabs.Trigger value="write">
					<T keyName="admin.settings.founder_welcome.editor_write" />
				</Tabs.Trigger>
				<Tabs.Trigger value="preview">
					<T keyName="admin.settings.founder_welcome.editor_preview" />
				</Tabs.Trigger>
			</Tabs.List>
			{#if tab === 'write'}
				<Tooltip.Provider>
					<div class="ms-auto flex flex-wrap items-center gap-1">
						<ToggleGroup.Root
							type="multiple"
							size="sm"
							spacing={1}
							aria-label={$t('admin.settings.founder_welcome.editor_formatting')}
							bind:value={
								() => formatTools.filter((tool) => formats[tool.id]).map((tool) => tool.id),
								setFormats
							}
						>
							{#each formatTools as tool (tool.id)}
								{@render toggle(tool)}
							{/each}
						</ToggleGroup.Root>
						<Separator orientation="vertical" class="data-[orientation=vertical]:h-4" />
						<ToggleGroup.Root
							type="single"
							size="sm"
							spacing={1}
							aria-label={$t('admin.settings.founder_welcome.editor_lists')}
							bind:value={() => formats.list ?? '', setList}
						>
							{#each listTools as tool (tool.id)}
								{@render toggle(tool)}
							{/each}
						</ToggleGroup.Root>
						<Separator orientation="vertical" class="data-[orientation=vertical]:h-4" />
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button {...props} variant="ghost" size="sm" onmousedown={keepFocus}>
										<BracesIcon />
										<T keyName="admin.settings.founder_welcome.editor_variable" />
										<ChevronDownIcon />
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content
								align="end"
								class="w-auto"
								onCloseAutoFocus={(event) => {
									event.preventDefault();
									textarea?.focus();
								}}
							>
								{#each FOUNDER_TEMPLATE_VARIABLES as name (name)}
									<DropdownMenu.Item
										onSelect={() => {
											const current = selection();
											if (current) apply(insertVariable(current, name));
										}}
									>
										{$t(variableLabelKeys[name])}
										<span class="ms-auto text-xs text-muted-foreground">{`{{${name}}}`}</span>
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
				</Tooltip.Provider>
			{/if}
		</InputGroup.Addon>
		<Tabs.Content value="write" class="w-full">
			<TemplateTextarea
				{id}
				rows={8}
				variables={[...FOUNDER_TEMPLATE_VARIABLES]}
				variant="embedded"
				data-slot="input-group-control"
				bind:ref={textarea}
				bind:value
				onkeydown={handleKeydown}
				onpaste={handlePaste}
				onselectionchange={syncRange}
			/>
		</Tabs.Content>
		<Tabs.Content value="preview" class="w-full">
			<!-- The email renders on white in both themes, with the block margins, list
			     markers and link styles mail clients keep and the app's reset removes. -->
			<div
				class="m-1 rounded-sm bg-white p-3 [&_:is(p,ul,ol)]:my-3.5 [&_:is(p,ul,ol):first-child]:mt-0 [&_:is(p,ul,ol):last-child]:mb-0 [&_a]:text-info [&_a]:underline [&_ol]:list-decimal [&_ol]:ps-6 [&_ul]:list-disc [&_ul]:ps-6"
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- The renderer escapes every value it emits -->
				{@html previewHtml}
			</div>
		</Tabs.Content>
	</InputGroup.Root>
</Tabs.Root>
