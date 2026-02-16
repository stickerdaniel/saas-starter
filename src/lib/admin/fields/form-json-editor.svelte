<script lang="ts">
	import { getShikiHighlighter } from '$lib/utils/shiki';
	import { T } from '@tolgee/svelte';
	import * as Field from '$lib/components/ui/field/index.js';
	import type { FieldDefinition } from '$lib/admin/types';

	type Props = {
		field: FieldDefinition<any>;
		value: unknown;
		error?: string;
		disabled?: boolean;
		testId?: string;
		onChange: (value: unknown) => void;
	};

	let { field, value, error, disabled = false, testId, onChange }: Props = $props();

	let editorValue = $state('');
	let highlightedHtml = $state('');
	let ready = $state(false);
	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let preEl: HTMLDivElement | undefined = $state();

	const language = $derived(field.type === 'code' ? 'typescript' : 'json');

	function serializeValue(input: unknown) {
		if (typeof input === 'string') return input;
		try {
			return JSON.stringify(input ?? null, null, 2);
		} catch {
			return String(input ?? '');
		}
	}

	$effect(() => {
		const nextValue = serializeValue(value);
		if (nextValue !== editorValue) {
			editorValue = nextValue;
		}
	});

	$effect(() => {
		ready = false;
		void (async () => {
			const highlighter = await getShikiHighlighter();
			highlightedHtml = highlighter.codeToHtml(editorValue, {
				lang: language,
				themes: {
					light: 'github-light',
					dark: 'github-dark'
				}
			});
			ready = true;
		})();
	});

	function handleInput(event: Event) {
		const target = event.currentTarget as HTMLTextAreaElement;
		editorValue = target.value;
		onChange(target.value);
	}

	function handleScroll() {
		if (!textareaEl || !preEl) return;
		preEl.scrollTop = textareaEl.scrollTop;
		preEl.scrollLeft = textareaEl.scrollLeft;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab') return;
		event.preventDefault();
		if (!textareaEl) return;

		const start = textareaEl.selectionStart;
		const end = textareaEl.selectionEnd;
		const nextValue = `${editorValue.slice(0, start)}  ${editorValue.slice(end)}`;
		editorValue = nextValue;
		onChange(nextValue);

		requestAnimationFrame(() => {
			if (!textareaEl) return;
			textareaEl.selectionStart = start + 2;
			textareaEl.selectionEnd = start + 2;
		});
	}
</script>

<Field.Field>
	<Field.Label><T keyName={field.labelKey} /></Field.Label>
	<div class="relative overflow-hidden rounded-md border font-mono text-sm leading-6">
		{#if !disabled}
			<textarea
				bind:this={textareaEl}
				value={editorValue}
				oninput={handleInput}
				onscroll={handleScroll}
				onkeydown={handleKeydown}
				spellcheck="false"
				autocomplete="off"
				autocapitalize="off"
				class="absolute inset-0 z-10 min-h-56 w-full resize-y bg-transparent p-4 text-transparent caret-foreground outline-none"
				data-testid={testId}
			></textarea>
		{/if}

		<div bind:this={preEl} class="relative min-h-56 w-full overflow-auto p-4" aria-hidden="true">
			{#if ready}
				<!-- Rendering trusted, escaped Shiki HTML -->
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html highlightedHtml}
			{:else}
				<pre><code>{editorValue}</code></pre>
			{/if}
		</div>
	</div>
	{#if field.helpTextKey}
		<Field.Description><T keyName={field.helpTextKey} /></Field.Description>
	{/if}
	{#if error}
		<Field.Error>{error}</Field.Error>
	{/if}
</Field.Field>
