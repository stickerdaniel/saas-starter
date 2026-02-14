<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { navigating } from '$app/stores';

	const SUPPRESSED_QUERY_KEYS = new SvelteSet(['sort', 'page', 'page_size', 'cursor', 'search']);
	const MINIMUM = 0.08;
	const SPEED = 200;
	const TRICKLE_MS = 200;
	const START_DELAY_MS = 100;

	let showBar = $state(false);
	let progress = $state(0);
	let opacity = $state(1);
	let speed = $state(SPEED);
	let started = false;
	let startDelayTimer: ReturnType<typeof setTimeout> | null = null;
	let trickleTimer: ReturnType<typeof setInterval> | null = null;
	let completeTimer: ReturnType<typeof setTimeout> | null = null;
	let fadeTimer: ReturnType<typeof setTimeout> | null = null;
	let barEl: HTMLDivElement | undefined = $state();

	function isPathNavigation(nav: typeof $navigating): boolean {
		if (!nav) return false;
		const fromPath = nav.from?.url.pathname;
		const toPath = nav.to?.url.pathname;

		if (!fromPath || !toPath || fromPath !== toPath) return true;

		const fromSearch = nav.from?.url.search ?? '';
		const toSearch = nav.to?.url.search ?? '';
		if (fromSearch === toSearch) return false;

		const fromParams = new URLSearchParams(fromSearch);
		const toParams = new URLSearchParams(toSearch);
		const changedKeys = new SvelteSet<string>();

		for (const key of fromParams.keys()) {
			if (fromParams.getAll(key).join(',') !== toParams.getAll(key).join(',')) changedKeys.add(key);
		}
		for (const key of toParams.keys()) {
			if (fromParams.getAll(key).join(',') !== toParams.getAll(key).join(',')) changedKeys.add(key);
		}

		if (changedKeys.size === 0) return false;
		for (const key of changedKeys) {
			if (!SUPPRESSED_QUERY_KEYS.has(key)) return true;
		}
		return false;
	}

	function clearTimers(): void {
		if (startDelayTimer) {
			clearTimeout(startDelayTimer);
			startDelayTimer = null;
		}
		if (trickleTimer) {
			clearInterval(trickleTimer);
			trickleTimer = null;
		}
		if (completeTimer) {
			clearTimeout(completeTimer);
			completeTimer = null;
		}
		if (fadeTimer) {
			clearTimeout(fadeTimer);
			fadeTimer = null;
		}
	}

	function inc(): void {
		let amount: number;
		if (progress < 0.2) amount = 0.1;
		else if (progress < 0.5) amount = 0.04;
		else if (progress < 0.8) amount = 0.02;
		else if (progress < 0.99) amount = 0.005;
		else amount = 0;
		progress = Math.min(progress + amount, 0.994);
	}

	async function showProgress(): Promise<void> {
		// Render bar at 0% with no transition
		speed = 0;
		showBar = true;
		opacity = 1;
		progress = 0;
		await tick();
		// Force reflow so browser commits the 0% position
		void barEl?.offsetWidth;
		// Enable transition and slide to minimum
		speed = SPEED;
		progress = MINIMUM;
		trickleTimer = setInterval(inc, TRICKLE_MS);
	}

	function startProgress(): void {
		clearTimers();
		// Delay showing the bar so instant navigations don't flash
		startDelayTimer = setTimeout(() => {
			startDelayTimer = null;
			showProgress();
		}, START_DELAY_MS);
	}

	function completeProgress(): void {
		clearTimers();
		if (!showBar) return;
		speed = SPEED;
		progress = 1;
		completeTimer = setTimeout(() => {
			opacity = 0;
			fadeTimer = setTimeout(() => {
				showBar = false;
				opacity = 1;
				progress = 0;
			}, SPEED);
		}, SPEED);
	}

	$effect(() => {
		const nav = $navigating;
		untrack(() => {
			if (isPathNavigation(nav) && !started) {
				started = true;
				startProgress();
			} else if (!isPathNavigation(nav) && started) {
				started = false;
				completeProgress();
			}
		});
	});
</script>

{#if showBar}
	<div class="route-progress">
		<div
			bind:this={barEl}
			class="route-progress__bar"
			style="transform: translate3d({(-1 + progress) *
				100}%, 0, 0); opacity: {opacity}; transition: all {speed}ms linear;"
		>
			<div class="route-progress__peg"></div>
		</div>
	</div>
{/if}

<style>
	.route-progress {
		pointer-events: none;
		position: fixed;
		z-index: 50;
		top: 0;
		left: 0;
		width: 100%;
		height: 2px;
		overflow: hidden;
	}

	.route-progress__bar {
		background: var(--primary);
		position: relative;
		width: 100%;
		height: 100%;
	}

	.route-progress__peg {
		position: absolute;
		right: 0;
		width: 100px;
		height: 100%;
		box-shadow:
			0 0 10px var(--primary),
			0 0 5px var(--primary);
		transform: rotate(3deg) translate(0, -4px);
	}
</style>
