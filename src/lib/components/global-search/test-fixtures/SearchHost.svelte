<script lang="ts">
	import { FormatSimple, Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import en from '../../../../i18n/en.json';
	import { setGlobalSearchContext } from '../context.svelte.ts';
	import GlobalSearchShell from '../global-search-shell.svelte';
	import CommandTrigger from '../command-trigger.svelte';

	const tolgee = Tolgee().use(FormatSimple()).init({ language: 'en', staticData: { en } });
	setGlobalSearchContext();
</script>

<TolgeeProvider {tolgee}>
	<CommandTrigger />
	<label>Unrelated input <input /></label>
	<GlobalSearchShell />
</TolgeeProvider>
