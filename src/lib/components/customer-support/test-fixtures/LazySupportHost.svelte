<script lang="ts">
	import { FormatSimple, Tolgee, TolgeeProvider } from '@tolgee/svelte';
	import en from '../../../../i18n/en.json';
	import LazyCustomerSupport from '../lazy-customer-support.svelte';

	const tolgee = Tolgee().use(FormatSimple()).init({ language: 'en', staticData: { en } });
</script>

<TolgeeProvider {tolgee}>
	<LazyCustomerSupport />
</TolgeeProvider>
