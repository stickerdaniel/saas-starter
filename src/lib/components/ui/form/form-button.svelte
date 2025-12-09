<script lang="ts">
	import { Button, type ButtonElementProps } from '$lib/components/ui/button/index.js';

	let { ref = $bindable(null), ...restProps }: ButtonElementProps = $props();
</script>

<Button bind:ref type="submit" {...restProps} />
