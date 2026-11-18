<script module lang="ts">
	import type { ActiveUploads } from '#lib/hooks/active-uploads.svelte.ts';

	/** The upload registry the enclosing layout provides, as last mounted. */
	export const provided: { uploads?: ActiveUploads } = {};
</script>

<script lang="ts">
	import { activeUploadsContext } from '#lib/hooks/active-uploads.svelte.ts';

	provided.uploads = activeUploadsContext.get();
</script>
