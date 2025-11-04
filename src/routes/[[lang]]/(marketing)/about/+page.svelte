<script lang="ts">
	import TeamTwo from '$blocks/team/team-two.svelte';
	import SEOHead from '$lib/components/SEOHead.svelte';
	import { getTranslate } from '@tolgee/svelte';

	const { t } = getTranslate();
</script>

<SEOHead title={$t('meta.about.title')} description={$t('meta.about.description')} />

<TeamTwo />
