<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';
	import type { FieldDefinition } from '$lib/admin/types';
	import * as Field from '$lib/components/ui/field/index.js';
	import { T, getTranslate } from '@tolgee/svelte';
	import { Textarea } from '$lib/components/ui/textarea/index.js';

	type Props = {
		field: FieldDefinition<any>;
		value: unknown;
		error?: string;
		disabled?: boolean;
		testId?: string;
		onChange: (value: unknown) => void;
	};

	let { field, value, error, disabled = false, testId, onChange }: Props = $props();
	const { t } = getTranslate();

	const markdown = $derived(typeof value === 'string' ? value : '');
	const renderedHtml = $derived.by(() => {
		const raw = marked.parse(markdown, { async: false });
		return DOMPurify.sanitize(raw);
	});
</script>

<Field.Field>
	<Field.Label><T keyName={field.labelKey} /></Field.Label>
	<div class="grid gap-3 lg:grid-cols-2">
		<Textarea
			value={markdown}
			{disabled}
			placeholder={field.placeholderKey
				? $t(field.placeholderKey)
				: $t('admin.resources.form.markdown_placeholder')}
			oninput={(event) => onChange((event.currentTarget as HTMLTextAreaElement).value)}
			data-testid={testId}
			class="min-h-56"
		/>
		<div class="prose max-w-none rounded-md border p-3 text-sm dark:prose-invert">
			{#if markdown.trim().length > 0}
				<!-- Marked output sanitized with DOMPurify -->
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html renderedHtml}
			{:else}
				<p class="text-muted-foreground">-</p>
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
