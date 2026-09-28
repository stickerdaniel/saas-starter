<script lang="ts">
	import Root from '../password.svelte';
	import Input from '../password-input.svelte';
	import Strength from '../password-strength.svelte';

	let { withStrength = false, invalid = false }: { withStrength?: boolean; invalid?: boolean } =
		$props();
</script>

<Root validationMessage="Choose a stronger password">
	<label for="password">Password</label>
	<Input id="password" required {invalid} />
	{#if withStrength}
		<Strength />
	{/if}
</Root>
