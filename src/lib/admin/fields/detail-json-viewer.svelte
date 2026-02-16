<script lang="ts">
	import type { FieldDefinition } from '$lib/admin/types';
	import { getShikiHighlighter } from '$lib/utils/shiki';
	import { T } from '@tolgee/svelte';

	type Props = {
		field: FieldDefinition<any>;
		value: unknown;
		record: Record<string, unknown>;
		testId?: string;
	};

	let { field, value, record: _record, testId }: Props = $props();

	let highlightedHtml = $state('');
	const language = $derived(field.type === 'code' ? 'typescript' : 'json');
	const code = $derived.by(() => {
		if (typeof value === 'string') return value;
		try {
			return JSON.stringify(value ?? null, null, 2);
		} catch {
			return String(value ?? '');
		}
	});

	$effect(() => {
		void (async () => {
			const highlighter = await getShikiHighlighter();
			highlightedHtml = highlighter.codeToHtml(code, {
				lang: language,
				themes: {
					light: 'github-light',
					dark: 'github-dark'
				}
			});
		})();
	});
</script>

<div class="space-y-2" data-testid={testId}>
	<p class="text-sm font-medium text-muted-foreground"><T keyName={field.labelKey} /></p>
	<div class="overflow-auto rounded-md border">
		{#if highlightedHtml}
			<!-- Rendering trusted, escaped Shiki HTML -->
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html highlightedHtml}
		{:else}
			<pre class="p-4 text-sm"><code>{code}</code></pre>
		{/if}
	</div>
</div>
