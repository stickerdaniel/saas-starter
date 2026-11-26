<script lang="ts">
	import { TolgeeCore, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import en from '../../../../../i18n/en.json';
	import ConnectedAppsSettings from '../connected-apps-settings.svelte';

	const tolgee = TolgeeCore().use(FormatIcu()).init({ language: 'en', staticData: { en } });
</script>

<TolgeeProvider {tolgee}>
	<ConnectedAppsSettings />
</TolgeeProvider>
