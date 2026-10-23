<script lang="ts">
	import { FormatSimple, TolgeeCore, TolgeeProvider } from '@tolgee/svelte';
	import en from '../../../../i18n/en.json';
	import LazyCustomerSupport from '../lazy-customer-support.svelte';

	const tolgee = TolgeeCore().use(FormatSimple()).init({ language: 'en', staticData: { en } });
</script>

<TolgeeProvider {tolgee}>
	<LazyCustomerSupport />
</TolgeeProvider>
