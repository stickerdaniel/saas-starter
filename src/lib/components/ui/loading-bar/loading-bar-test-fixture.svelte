<script lang="ts">
	import LoadingBar from './loading-bar.svelte';

	let value = $state(25);
	let mode = $state<'progress' | 'loading'>('progress');
	let indicatorTone = $state<'primary' | 'destructive' | 'muted'>('primary');
</script>

<LoadingBar {value} {mode} {indicatorTone} />
<button onclick={() => (value = 25.005)}>Change value slightly</button>
<button onclick={() => (value = 70)}>Change value</button>
<button onclick={() => (value = 100)}>Complete</button>
<button onclick={() => (mode = mode === 'progress' ? 'loading' : 'progress')}>Change mode</button>
<button onclick={() => (indicatorTone = 'destructive')}>Change tone</button>
