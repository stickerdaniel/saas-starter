<script lang="ts">
	import type { FieldDefinition } from '$lib/admin/types';
	import { T } from '@tolgee/svelte';

	type Props = {
		field: FieldDefinition<any>;
		value: unknown;
		record: Record<string, unknown>;
		testId?: string;
	};

	let { field, value, record, testId }: Props = $props();

	const componentPromise = import('./detail-json-viewer.svelte');
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
	<Component {field} {value} {record} {testId} />
{/await}
