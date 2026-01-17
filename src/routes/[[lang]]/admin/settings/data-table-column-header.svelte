<script lang="ts">
	import { T } from '@tolgee/svelte';

	type Props = {
		titleKey: string;
		class?: string;
	};

	let { titleKey, class: className = '' }: Props = $props();
</script>

<div class={className}>
	<T keyName={titleKey} />
</div>
