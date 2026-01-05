<script lang="ts">
	import EmailPreview from 'better-svelte-email/preview/EmailPreview.svelte';
	import { page } from '$app/stores';
</script>

<EmailPreview page={$page} />
