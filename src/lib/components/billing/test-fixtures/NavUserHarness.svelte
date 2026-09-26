<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import NavUser from '$lib/components/nav-user.svelte';
</script>

<!-- The app shell's sidebar provides the context the user menu reads. -->
<Sidebar.Provider>
	<NavUser user={{ name: 'Visitor', email: 'visitor@example.com', avatar: '' }} />
</Sidebar.Provider>
