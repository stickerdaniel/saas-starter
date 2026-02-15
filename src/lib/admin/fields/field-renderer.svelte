<script lang="ts">
	import type { FieldContext, FieldDefinition } from '$lib/admin/types';
	import { getFieldComponent } from './registry';

	type Option = { value: string; label: string };

	type Props = {
		field: FieldDefinition<any>;
		context: FieldContext;
		record: Record<string, unknown>;
		value: unknown;
		testId?: string;
		error?: string;
		relationOptions?: Option[];
		onChange?: (value: unknown) => void;
	};

	let {
		field,
		context,
		record,
		value,
		testId,
		error,
		relationOptions = [],
		onChange = () => {}
	}: Props = $props();

	const Component = $derived(getFieldComponent(field.type, context));
</script>

<Component {field} {value} {record} {testId} {error} {relationOptions} {onChange} />
