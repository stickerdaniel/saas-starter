<script lang="ts">
	import { Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import en from '../../../../i18n/en.json';
	import type { CatalogueEntry } from '$lib/licenses/catalogue';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import ThirdPartyLicenses from '../third-party-licenses.svelte';

	let { entries }: { entries: CatalogueEntry[] | null } = $props();
	const tolgee = Tolgee().use(FormatIcu()).init({ language: 'en', staticData: { en } });
</script>

<TolgeeProvider {tolgee}>
	<Tooltip.Provider>
		<ThirdPartyLicenses {entries} />
	</Tooltip.Provider>
</TolgeeProvider>
