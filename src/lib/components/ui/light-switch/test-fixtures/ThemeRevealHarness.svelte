<script lang="ts">
	import { FormatSimple, TolgeeCore, TolgeeProvider } from '@tolgee/svelte';
	import en from '../../../../../i18n/en.json';
	import LightSwitch from '../light-switch.svelte';

	const tolgee = TolgeeCore().use(FormatSimple()).init({ language: 'en', staticData: { en } });
</script>

<TolgeeProvider {tolgee}>
	<LightSwitch />
</TolgeeProvider>
