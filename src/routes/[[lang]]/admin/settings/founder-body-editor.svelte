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
	import * as Kbd from '#lib/components/ui/kbd/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { TemplateTextarea } from '#lib/components/ui/template-textarea/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { cmdOrCtrl } from '#lib/hooks/is-mac.svelte.ts';
	import {
		FOUNDER_TEMPLATE_VARIABLES,
		renderFounderEmail,
		type FounderTemplateVariables
	} from '#lib/convex/emails/founderTemplate.js';
	import {
		insertVariable,
		pasteLink,
		toggleBold,
		toggleLink,
		toggleList,
		type BodyEdit,
		type BodySelection
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

	type Tool = {
		labelKey: string;
		/** The `key` (or, with Shift, the `code`) that runs the tool with Cmd or Ctrl. */
		shortcut: string;
		keys: string[];
		icon: typeof BoldIcon;
		edit: (selection: BodySelection) => BodyEdit | undefined;
	};

	const tools: Tool[] = [
		{
			labelKey: 'admin.settings.founder_welcome.editor_bold',
			shortcut: 'b',
			keys: [cmdOrCtrl, 'B'],
			icon: BoldIcon,
			edit: toggleBold
		},
		{
			labelKey: 'admin.settings.founder_welcome.editor_link',
			shortcut: 'k',
			keys: [cmdOrCtrl, 'K'],
			icon: LinkIcon,
			edit: toggleLink
		},
		{
			labelKey: 'admin.settings.founder_welcome.editor_bulleted_list',
			shortcut: 'Digit8',
			keys: [cmdOrCtrl, '⇧', '8'],
			icon: ListIcon,
			edit: (selection) => toggleList(selection, false)
		},
		{
			labelKey: 'admin.settings.founder_welcome.editor_numbered_list',
			shortcut: 'Digit7',
			keys: [cmdOrCtrl, '⇧', '7'],
			icon: ListOrderedIcon,
			edit: (selection) => toggleList(selection, true)
		}
	];

	function selection(): BodySelection | undefined {
		if (!textarea) return undefined;
		return { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd };
	}

	/** Apply an edit through the undo stack, then select its result. */
	function apply(edit: BodyEdit | undefined) {
		if (!edit || !textarea) return;
		textarea.focus();
		textarea.setSelectionRange(edit.from, edit.to);
		// insertText keeps the edit undoable; setRangeText covers engines without it.
		if (!document.execCommand?.('insertText', false, edit.text)) {
			textarea.setRangeText(edit.text, edit.from, edit.to, 'end');
			textarea.dispatchEvent(new Event('input', { bubbles: true }));
		}
		textarea.setSelectionRange(...edit.select);
	}

	function run(tool: Tool) {
		const current = selection();
		if (current) apply(tool.edit(current));
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
		const key = event.shiftKey ? event.code : event.key.toLowerCase();
		const tool = tools.find((candidate) => candidate.shortcut === key);
		if (!tool) return;
		event.preventDefault();
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

<Tabs.Root bind:value={tab}>
	<div
		class="rounded-md border border-input shadow-xs transition-field-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
	>
		<div class="flex items-center gap-0.5 border-b p-1">
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
					<div class="ms-auto flex items-center gap-0.5">
						{#each tools as tool (tool.labelKey)}
							<Tooltip.Root>
								<Tooltip.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon-sm"
											aria-label={$t(tool.labelKey)}
											onmousedown={keepFocus}
											onclick={() => run(tool)}
										>
											<tool.icon />
										</Button>
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
						{/each}
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
								class="w-64"
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
		</div>
		<Tabs.Content value="write">
			<TemplateTextarea
				{id}
				rows={8}
				variables={[...FOUNDER_TEMPLATE_VARIABLES]}
				variant="embedded"
				bind:ref={textarea}
				bind:value
				onkeydown={handleKeydown}
				onpaste={handlePaste}
			/>
		</Tabs.Content>
		<Tabs.Content value="preview">
			<!-- The email renders on white in both themes, with the block margins, list
			     markers and link styles mail clients keep and the app's reset removes. -->
			<div
				data-testid="founder-body-preview"
				class="m-1 rounded-sm bg-white p-3 [&_:is(p,ul,ol)]:my-3.5 [&_:is(p,ul,ol):first-child]:mt-0 [&_:is(p,ul,ol):last-child]:mb-0 [&_a]:text-info [&_a]:underline [&_ol]:list-decimal [&_ol]:ps-6 [&_ul]:list-disc [&_ul]:ps-6"
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- The renderer escapes every value it emits -->
				{@html previewHtml}
			</div>
		</Tabs.Content>
	</div>
</Tabs.Root>
