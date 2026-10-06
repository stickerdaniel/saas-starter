<script lang="ts">
	import { Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import en from '../../../../../i18n/en.json';
	import Root from '../password.svelte';
	import Input from '../password-input.svelte';
	import Strength from '../password-strength.svelte';

	let { withStrength = false, invalid = false }: { withStrength?: boolean; invalid?: boolean } =
		$props();
	const tolgee = Tolgee().use(FormatIcu()).init({ language: 'en', staticData: { en } });
</script>

<TolgeeProvider {tolgee}>
	<Root validationMessage="Choose a stronger password">
		<label for="password">Password</label>
		<Input id="password" required {invalid} />
		{#if withStrength}
			<Strength />
		{/if}
	</Root>
</TolgeeProvider>
