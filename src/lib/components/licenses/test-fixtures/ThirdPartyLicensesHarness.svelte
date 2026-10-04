<script lang="ts">
	import { Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import en from '../../../../i18n/en.json';
	import ThirdPartyLicenses from '../third-party-licenses.svelte';

	let { available = true } = $props();
	const tolgee = Tolgee().use(FormatIcu()).init({ language: 'en', staticData: { en } });
</script>

<TolgeeProvider {tolgee}>
	<ThirdPartyLicenses catalogueUrl="/third-party-licenses.json" {available} />
</TolgeeProvider>
