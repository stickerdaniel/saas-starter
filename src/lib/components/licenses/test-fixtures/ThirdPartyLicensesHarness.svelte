<script lang="ts">
	import { Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import en from '../../../../i18n/en.json';
	import type { CatalogueEntry } from '$lib/licenses/catalogue';
	import ThirdPartyLicenses from '../third-party-licenses.svelte';

	let { entries }: { entries: CatalogueEntry[] | null } = $props();
	const tolgee = Tolgee().use(FormatIcu()).init({ language: 'en', staticData: { en } });
</script>

<TolgeeProvider {tolgee}>
	<ThirdPartyLicenses {entries} />
</TolgeeProvider>
