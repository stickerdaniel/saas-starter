<script lang="ts" module>
	export type ContextNode = {
		initialize: () => string | void;
		children?: ContextNode[];
	};
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import ContextScope from './ContextScope.svelte';

	let { node }: { node: ContextNode } = $props();
	const result = untrack(() => node.initialize());
</script>

{result ?? ''}
{#each node.children ?? [] as child (child)}
	<ContextScope node={child} />
{/each}
