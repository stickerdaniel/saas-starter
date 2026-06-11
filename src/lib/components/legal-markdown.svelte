<script lang="ts">
	import { Streamdown } from 'svelte-streamdown';
	import { localizedHref } from '$lib/utils/i18n';

	let { content }: { content: string } = $props();

	// Streamdown's URL hardening only lets absolute http(s) URLs and
	// "/"-prefixed paths through, so bare relative targets like "privacy"
	// would render as blocked. Rewrite them to lang-prefixed root-relative
	// paths, matching how marketing-footer builds its legal links. The
	// content is build-time-constant trusted markdown from $lib/content.
	const localizedContent = $derived(
		content.replace(
			/\]\((?!https?:\/\/|\/|#|mailto:)([^)\s]+)\)/g,
			(_match, path: string) => `](${localizedHref(`/${path}`)})`
		)
	);
</script>

<Streamdown content={localizedContent} baseTheme="shadcn" static />
