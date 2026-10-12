<!--
  Decorative isometric desk computer that types the saas-starter CLI commands.
  The figure comes from anatomy (MIT); desk-computer.svg records its provenance.
-->
<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	let { class: className = '' }: { class?: string } = $props();

	let loaded = $state(false);

	// The ~180 KB figure stays out of the SSR HTML and the critical path: it loads
	// after the page's load event once the browser is idle, then starts its animation.
	const figure: Attachment<HTMLDivElement> = (host) => {
		let destroyed = false;
		let stop: (() => void) | undefined;
		let idleId: number | undefined;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		async function show() {
			const [{ default: markup }, { animateDeskComputer }] = await Promise.all([
				import('./desk-computer.svg?raw'),
				import('./desk-computer.js')
			]);
			if (destroyed) return;
			// Trusted, bundled static asset; no user input reaches this markup.
			host.innerHTML = markup;
			const svg = host.querySelector('svg');
			if (!svg) return;
			stop = animateDeskComputer(svg);
			loaded = true;
		}

		function schedule() {
			if ('requestIdleCallback' in window) {
				idleId = window.requestIdleCallback(() => void show());
			} else {
				timeoutId = setTimeout(() => void show(), 10_000);
			}
		}

		if (document.readyState === 'complete') schedule();
		else window.addEventListener('load', schedule, { once: true });

		return () => {
			destroyed = true;
			window.removeEventListener('load', schedule);
			if (idleId !== undefined) window.cancelIdleCallback(idleId);
			clearTimeout(timeoutId);
			stop?.();
		};
	};
</script>

<div
	class={[
		'transition-opacity duration-700 ease-out motion-reduce:transition-none',
		loaded ? 'opacity-100' : 'opacity-0',
		className
	]}
	aria-hidden="true"
>
	<div class="desk-computer" {@attach figure}></div>
</div>

<style>
	/* Theme tokens of the anatomy kit: its light values here, its dark values under the
	   app's .dark class. Solids fill with the page background so the figure blends in. */
	.desk-computer {
		--anatomy-paper: var(--background);
		--anatomy-top: #ffffff;
		--anatomy-shade-0: #dcdcd9;
		--anatomy-shade-1: #e5e5e2;
		--anatomy-shade-2: #ededea;
		--anatomy-shade-3: #f4f4f1;
		--anatomy-lit-shade: #eeeeeb;
		--anatomy-hi: #26262a;
		--anatomy-mid: #8a8a8f;
		--anatomy-lo: #b4b4b8;
		--anatomy-faint: #d4d4d6;
		--anatomy-lit: #000000;
		--anatomy-halo: #8a8a80;
		--anatomy-halo-opacity: 0.32;
		--anatomy-dot: #3a3a3e;
		--anatomy-weight: 0.6px;
		--anatomy-ease: cubic-bezier(0.32, 0.72, 0, 1);
		--anatomy-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
	}

	:global(.dark) .desk-computer {
		--anatomy-top: #1c1c1c;
		--anatomy-shade-0: #0f0f0f;
		--anatomy-shade-1: #121212;
		--anatomy-shade-2: #151515;
		--anatomy-shade-3: #181818;
		--anatomy-lit-shade: #1d1d1d;
		--anatomy-hi: #d4d4d4;
		--anatomy-mid: #6a6a6a;
		--anatomy-lo: #3e3e3e;
		--anatomy-faint: #2a2a2a;
		--anatomy-lit: #ffffff;
		--anatomy-halo: #050505;
		--anatomy-halo-opacity: 0.9;
		--anatomy-dot: #e6e6e6;
	}

	/* The injected SVG is not part of this component's markup, so its rules are global
	   below the scoped wrapper. */
	.desk-computer :global {
		.iso-svg {
			display: block;
			width: 100%;
			height: auto;
			overflow: visible;
		}
		.iso-svg path,
		.iso-svg circle {
			vector-effect: non-scaling-stroke;
		}
		.iso-fill {
			fill: var(--anatomy-paper);
			stroke: none;
		}
		.iso-shade,
		.iso-top {
			stroke: none;
		}
		.iso-shade[data-shade='0'] {
			fill: var(--anatomy-shade-0);
		}
		.iso-shade[data-shade='1'] {
			fill: var(--anatomy-shade-1);
		}
		.iso-shade[data-shade='2'] {
			fill: var(--anatomy-shade-2);
		}
		.iso-shade[data-shade='3'] {
			fill: var(--anatomy-shade-3);
		}
		.iso-top {
			fill: var(--anatomy-top);
		}
		.iso-halo {
			fill: var(--anatomy-halo);
			stroke: none;
			filter: blur(9px);
			opacity: var(--anatomy-halo-opacity);
			transform: translateY(3px);
		}
		.iso-line {
			fill: none;
			stroke: var(--anatomy-lo);
			stroke-width: var(--anatomy-weight);
			stroke-linecap: round;
			stroke-linejoin: round;
		}
		.iso-line[data-tone='hi'] {
			stroke: var(--anatomy-hi);
		}
		.iso-line[data-tone='mid'] {
			stroke: var(--anatomy-mid);
		}
		.iso-line[data-tone='faint'] {
			stroke: var(--anatomy-faint);
		}
		.iso-dots circle {
			fill: var(--anatomy-dot);
			stroke: none;
			opacity: 0.32;
		}
		.iso-dots[data-tone='hi'] circle {
			opacity: 0.85;
		}
		.iso-dots[data-tone='mid'] circle {
			opacity: 0.45;
		}

		.pc-bezel {
			fill: var(--anatomy-top);
		}
		.pc-dark {
			fill: var(--anatomy-shade-0);
		}
		.pc-glass {
			fill: var(--anatomy-shade-0);
			transition: fill 0.5s var(--anatomy-ease);
		}
		.pc-glass[data-on] {
			fill: var(--anatomy-lit-shade);
		}
		.pc-glow {
			fill: var(--anatomy-lit);
			opacity: 0.07;
			filter: blur(6px);
		}
		.pc-scan {
			fill: none;
			stroke: var(--anatomy-faint);
			stroke-width: 0.5px;
			opacity: 0.7;
		}
		.pc-logo {
			fill: none;
			stroke: var(--anatomy-lit);
			stroke-width: 2.2;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
		.pc-text {
			fill: var(--anatomy-lit);
			font-family: var(--anatomy-mono);
			letter-spacing: 0.02em;
		}
		.pc-cursor {
			fill: var(--anatomy-lit);
		}
		/* Blinks only while the tour types or shortly after a click; idle, it holds still. */
		.pc-cursor[data-blink] {
			animation: desk-computer-blink 1.06s steps(1, end) infinite;
		}
		.pc-beam {
			fill: none;
			stroke: var(--anatomy-lit);
			stroke-width: 1.4px;
			stroke-linecap: round;
		}
		.pc-dot {
			fill: var(--anatomy-lit);
		}
		.pc-cord {
			stroke-width: 1.1px;
		}
		.pc-key,
		.pc-computer {
			cursor: pointer;
		}
		.pc-key[data-down] .iso-edge {
			stroke: var(--anatomy-hi);
		}
		[data-part='led'] {
			transition: opacity 0.4s var(--anatomy-ease);
		}
	}

	@keyframes -global-desk-computer-blink {
		50% {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.desk-computer :global(.pc-cursor[data-blink]) {
			animation: none;
		}
	}
</style>
