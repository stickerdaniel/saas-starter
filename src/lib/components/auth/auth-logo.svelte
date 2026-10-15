<script lang="ts">
	import { getTranslate } from '@tolgee/svelte';
	import { resolve } from '$app/paths';
	import Logo from '#lib/components/icons/logo.svelte';
	import { localizedHref } from '#lib/utils/i18n.js';

	const { t } = getTranslate();
</script>

<!-- The logo above an auth card column's heading, linking home. A plain link,
     so it also leads out of a page that never hydrated. -->
<a
	href={resolve(localizedHref('/'))}
	aria-label={$t('auth.back_to_home')}
	class="mb-6 flex w-fit text-foreground transition-opacity hover:opacity-70"
>
	<Logo class="size-6" />
</a>
