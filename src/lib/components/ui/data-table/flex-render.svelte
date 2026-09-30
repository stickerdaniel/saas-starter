<script
	lang="ts"
	generics="TFeatures extends TableFeatures, TData extends RowData, TValue, TContext extends HeaderContext<TFeatures, TData, TValue> | CellContext<TFeatures, TData, TValue>"
>
	import type {
		CellContext,
		ColumnDefTemplate,
		HeaderContext,
		RowData,
		TableFeatures
	} from '@tanstack/table-core';
	import { RenderComponentConfig, RenderSnippetConfig } from './render-helpers.js';
	import type { Attachment } from 'svelte/attachments';
	type Props = {
		/** The cell or header field of the current cell's column definition. */
		content?: TContext extends HeaderContext<TFeatures, TData, TValue>
			? ColumnDefTemplate<HeaderContext<TFeatures, TData, TValue>>
			: TContext extends CellContext<TFeatures, TData, TValue>
				? ColumnDefTemplate<CellContext<TFeatures, TData, TValue>>
				: never;
		/** The result of the `getContext()` function of the header or cell */
		context: TContext;

		/** Used to pass attachments that can't be gotten through context */
		attach?: Attachment;
	};

	let { content, context, attach }: Props = $props();
</script>

{#if typeof content === 'string'}
	{content}
{:else if content instanceof Function}
	<!-- It's unlikely that a CellContext will be passed to a Header -->
	<!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -->
	{@const result = content(context as any)}
	{#if result instanceof RenderComponentConfig}
		{@const { component: Component, props } = result}
		<Component {...props} {attach} />
	{:else if result instanceof RenderSnippetConfig}
		{@const { snippet, params } = result}
		{@render snippet({ ...params, attach })}
	{:else}
		{result}
	{/if}
{/if}
