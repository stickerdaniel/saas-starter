<script lang="ts">
	let {
		user,
		domain,
		tld,
		class: className = ''
	}: {
		user: string;
		domain: string;
		tld: string;
		class?: string;
	} = $props();

	function handleClick(e: MouseEvent) {
		e.preventDefault();
		window.location.href = `mailto:${user}@${domain}.${tld}`;
	}
</script>

<!-- Hidden span decoys reduce the chance of naive regex scrapers extracting a valid email address.
     The mailto: is only assembled via JS onclick. Not a guarantee against headless-browser scrapers. -->
<!-- Anti-scraping: aria-label intentionally NOT localized via Tolgee. Putting email parts
     in i18n bundles would defeat the obfuscation. English "at"/"dot" format is acceptable
     since this component is only used for static contact info on legal pages. -->
<!-- eslint-disable local/no-hardcoded-aria-label -->
<button
	onclick={handleClick}
	class="cursor-pointer {className}"
	type="button"
	aria-label="{user} at {domain} dot {tld}"
	>{user}<span class="hidden" aria-hidden="true">.nope</span>@<span
		class="hidden"
		aria-hidden="true">null.</span
	>{domain}<span class="hidden" aria-hidden="true">.fake</span>.{tld}</button
>
<!-- eslint-enable local/no-hardcoded-aria-label -->
