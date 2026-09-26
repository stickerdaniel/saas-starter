<script lang="ts">
	import { FormatSimple, Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import { ModeWatcher } from 'mode-watcher';
	import en from '../../../../../i18n/en.json';
	import LightSwitch from '../light-switch.svelte';

	const tolgee = Tolgee().use(FormatSimple()).init({ language: 'en', staticData: { en } });
</script>

<!-- No synchronousModeChanges here: mode-watcher writes synchronously under Vitest
	either way, so this harness proves only the switch's own flush. The root layout's
	prop is covered in a real browser by e2e/public-theme-capture.spec.ts. -->
<ModeWatcher />
<TolgeeProvider {tolgee}>
	<LightSwitch />
</TolgeeProvider>
