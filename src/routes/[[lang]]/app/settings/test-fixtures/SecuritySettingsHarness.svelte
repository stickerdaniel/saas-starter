<script lang="ts">
	import { Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import { FormatIcu } from '@tolgee/format-icu';
	import en from '../../../../../i18n/en.json';
	import de from '../../../../../i18n/de.json';
	import es from '../../../../../i18n/es.json';
	import fr from '../../../../../i18n/fr.json';
	import SecuritySettings from '../security-settings.svelte';

	let { name = 'Daniel Example', language = 'en' } = $props();
	// Each test initializes the provider once, then uses the exported setters.
	// svelte-ignore state_referenced_locally
	const tolgee = Tolgee().use(FormatIcu()).init({ language, staticData: { en, de, es, fr } });
	// svelte-ignore state_referenced_locally
	let user = $state({ name });

	export function setName(name: string) {
		user = { name };
	}

	export async function setLanguage(language: string) {
		await tolgee.changeLanguage(language);
	}
</script>

<TolgeeProvider {tolgee}>
	<SecuritySettings {user} />
</TolgeeProvider>
