<script lang="ts">
	import SidebarPasskeyOffer from '../sidebar-passkey-offer.svelte';
	import { PasskeyNudgeClaim } from '../passkey-enrollment.svelte.ts';
	// Owned here like the app shell owns it, so the card can remount around it.
	const nudge = new PasskeyNudgeClaim(() => true);
	// Stands in for the sidebar switching between the desktop rail and the mobile sheet.
	let cardMounted = $state(true);
</script>

<button type="button" onclick={() => (cardMounted = !cardMounted)}>Remount card</button>
{#if nudge.offer && cardMounted}<SidebarPasskeyOffer {nudge} />{/if}
