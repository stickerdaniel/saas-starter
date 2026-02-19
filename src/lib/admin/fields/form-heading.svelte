<script lang="ts">
	import { T } from '@tolgee/svelte';
	import type { FieldDefinition } from '$lib/admin/types';

	type Props = {
		field: FieldDefinition<any>;
	};

	let { field }: Props = $props();
</script>

<div class="border-b pb-2 pt-4">
	<h3 class="text-lg font-semibold"><T keyName={field.labelKey} /></h3>
	{#if field.helpTextKey}
		<p class="text-sm text-muted-foreground"><T keyName={field.helpTextKey} /></p>
	{/if}
</div>
