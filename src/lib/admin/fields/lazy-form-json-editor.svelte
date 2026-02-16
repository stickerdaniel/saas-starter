<script lang="ts">
	import type { FieldDefinition } from '$lib/admin/types';
	import { T } from '@tolgee/svelte';

	type Props = {
		field: FieldDefinition<any>;
		value: unknown;
		testId?: string;
		error?: string;
		disabled?: boolean;
		onChange?: (value: unknown) => void;
	};

	let { field, value, testId, error, disabled = false, onChange = () => {} }: Props = $props();

	const componentPromise = import('./form-json-editor.svelte');
</script>

{#await componentPromise}
	<div
		class="rounded-md border p-3 text-sm text-muted-foreground"
		data-testid={testId ? `${testId}-loading` : undefined}
	>
		<T keyName="admin.resources.loading" />
	</div>
{:then module}
	{@const Component = module.default as any}
	<Component {field} {value} {testId} {error} {disabled} {onChange} />
{/await}
