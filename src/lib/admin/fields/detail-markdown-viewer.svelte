<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';
	import type { FieldDefinition } from '$lib/admin/types';
	import { T } from '@tolgee/svelte';

	type Props = {
		field: FieldDefinition<any>;
		value: unknown;
		record: Record<string, unknown>;
		testId?: string;
	};

	let { field, value, record: _record, testId }: Props = $props();

	const markdown = $derived(typeof value === 'string' ? value : '');
	const renderedHtml = $derived.by(() => {
		const raw = /<\/?[a-z][\s\S]*>/i.test(markdown)
			? markdown
			: marked.parse(markdown, { async: false });
		return DOMPurify.sanitize(raw);
	});
</script>

<div class="space-y-2" data-testid={testId}>
	<p class="text-sm font-medium text-muted-foreground"><T keyName={field.labelKey} /></p>
	{#if markdown.trim().length > 0}
		<div class="prose max-w-none text-sm dark:prose-invert">
			<!-- Marked output sanitized with DOMPurify -->
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html renderedHtml}
		</div>
	{:else}
		<p class="text-muted-foreground">-</p>
	{/if}
</div>
