<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import NavUser from '$lib/components/nav-user.svelte';
	import { ImpersonationState, impersonationContext } from '$lib/hooks/use-impersonation.svelte.ts';

	// The root layout owns this in the app; the user menu only reads it.
	impersonationContext.set(new ImpersonationState());
</script>

<!-- The app shell's sidebar provides the context the user menu reads. -->
<Sidebar.Provider>
	<NavUser user={{ name: 'Visitor', email: 'visitor@example.com', avatar: '' }} />
</Sidebar.Provider>
