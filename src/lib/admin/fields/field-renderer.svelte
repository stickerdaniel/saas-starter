<script lang="ts">
	import type { FieldContext, FieldDefinition } from '$lib/admin/types';
	import type { BetterAuthUser } from '$lib/convex/admin/types';
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
		allValues?: Record<string, unknown>;
		viewer?: BetterAuthUser;
		onChange?: (value: unknown) => void;
		onRelationCreated?: (fieldAttribute: string, newOption: Option) => void;
		onCreateTag?: (name: string) => Promise<string | null>;
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
		allValues = {},
		viewer,
		onChange = () => {},
		onRelationCreated,
		onCreateTag
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
	{allValues}
	{viewer}
	{onChange}
	{onRelationCreated}
	{onCreateTag}
/>
