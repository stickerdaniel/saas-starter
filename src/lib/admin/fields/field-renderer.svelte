<script lang="ts">
	import type { FieldContext, FieldDefinition } from '$lib/admin/types';
	import { getFieldComponent } from './registry';

	type Option = { value: string; label: string };

	type Props = {
		field: FieldDefinition<any>;
		context: FieldContext;
		record: Record<string, unknown>;
		value: unknown;
		mode?: 'resolved' | 'loading';
		testId?: string;
		error?: string;
		disabled?: boolean;
		relationOptions?: Option[];
		onChange?: (value: unknown) => void;
	};

	let {
		field,
		context,
		record,
		value,
		mode = 'resolved',
		testId,
		error,
		disabled = false,
		relationOptions = [],
		onChange = () => {}
	}: Props = $props();

	const Component = $derived(
		field.renderOverride?.[context] ?? getFieldComponent(field.type, context)
	);
</script>

<Component
	{field}
	{value}
	{record}
	{context}
	{mode}
	{testId}
	{error}
	{disabled}
	{relationOptions}
	{onChange}
/>
