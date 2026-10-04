<script lang="ts">
	// Tolgee's <T> component, rendered through the test translation store.
	import { translation } from './translation';

	let { keyName, params }: { keyName: string; params?: Record<string, unknown> } = $props();
</script>

{$translation(keyName, params)}
