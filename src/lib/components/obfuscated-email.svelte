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

<!--
  Anti-scraping: hidden <span> decoys break regex pattern matching.
  Bots see "daniel<hidden junk>@<hidden junk>sticker<hidden junk>.<hidden junk>name"
  which doesn't match email regex. Humans see "daniel@sticker.name" correctly.
  Copy-paste includes the hidden text, producing an invalid address.
-->
<button onclick={handleClick} class="cursor-pointer {className}" type="button"
	>{user}<span class="hidden" aria-hidden="true">.nope</span>@<span
		class="hidden"
		aria-hidden="true">null.</span
	>{domain}<span class="hidden" aria-hidden="true">.fake</span>.{tld}</button
>
