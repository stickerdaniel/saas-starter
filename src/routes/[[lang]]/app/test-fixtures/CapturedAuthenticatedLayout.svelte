<script module lang="ts">
	import type { ComponentProps } from 'svelte';
	import type AuthenticatedLayout from '#lib/components/authenticated/authenticated-layout.svelte';

	type ShellProps = ComponentProps<typeof AuthenticatedLayout>;

	let read: (() => ShellProps) | undefined;

	/** The current props the app layout passes to its shell, from the last mount. */
	export function shellProps(): ShellProps {
		if (!read) throw new Error('The authenticated shell is not mounted');
		return read();
	}
</script>

<script lang="ts">
	let props: ShellProps = $props();

	read = () => props;
</script>

{@render props.children?.()}
