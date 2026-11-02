<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { resolve } from '$app/paths';
	import Logo from '#lib/components/icons/logo.svelte';
	import { localizedHref } from '#lib/utils/i18n.js';

	const { t } = getTranslate();
</script>

<!--
	The brand mark at the top of an auth card, leading to the marketing home. Only for cards a
	visitor sees before signing in: once a sign-in is under way, a link out would drop the
	destination it is taking them to, so those cards show the plain mark.
-->
<a
	href={resolve(localizedHref('/'))}
	aria-label={$t('auth.back_to_home')}
	class="mb-6 block w-fit text-foreground transition-opacity hover:opacity-70"
>
	<!-- Block, so no line box pads the 24px mark and the heading keeps its place. -->
	<Logo class="block size-6" />
</a>
