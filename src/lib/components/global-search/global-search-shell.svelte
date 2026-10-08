<script lang="ts">
	import { haptic } from '#lib/hooks/use-haptic.svelte.ts';
	import { useGlobalSearchContext } from './context.svelte.ts';

	const globalSearch = useGlobalSearchContext();

	function isTypingTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;

		return (
			target.isContentEditable ||
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement
		);
	}

	function handleShortcut(event: KeyboardEvent): void {
		const isShortcut = (event.key === 'k' && (event.metaKey || event.ctrlKey)) || event.key === '/';
		if (!isShortcut || isTypingTarget(event.target)) return;

		event.preventDefault();
		if (!globalSearch.open) haptic.trigger('light');
		globalSearch.toggleMenu();
	}
</script>

<svelte:document onkeydown={handleShortcut} />

{#if globalSearch.shouldLoadMenu}
	{#await import('./command-menu.svelte') then { default: CommandMenu }}
		<CommandMenu />
	{/await}
{/if}
