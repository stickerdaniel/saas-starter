<!--
  Decorative isometric desk computer that types the saas-starter CLI commands.
  The figure comes from anatomy (MIT); desk-computer.svg records its provenance.
-->
<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import markup from './desk-computer.svg?raw';

	let { class: className = '' }: { class?: string } = $props();

	// The server renders the figure so it paints with the page. Its animation loads
	// after the page's load event once the browser is idle, off the critical path.
	const animate: Attachment<HTMLDivElement> = (host) => {
		let destroyed = false;
		let stop: (() => void) | undefined;
		let idleId: number | undefined;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		async function start() {
			const { animateDeskComputer } = await import('./desk-computer.js');
			const svg = host.querySelector('svg');
			if (destroyed || !svg) return;
			stop = animateDeskComputer(svg);
		}

		function schedule() {
			if ('requestIdleCallback' in window) {
				idleId = window.requestIdleCallback(() => void start());
			} else {
				timeoutId = setTimeout(() => void start(), 10_000);
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

<div class={['desk-computer', className]} aria-hidden="true" {@attach animate}>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- Trusted build-time constant inlined from desk-computer.svg, no user input -->
	{@html markup}
</div>

<style>
	/* The figure has no outlines, its faces are fills in tones derived from the app theme:
	   faces toward the viewer take the page background, tops a light grey, and the faces
	   turned away step darker. The screen is dark in both themes. */
	.desk-computer {
		--anatomy-top: color-mix(in oklch, var(--muted) 60%, var(--border));
		--anatomy-shade-3: var(--background);
		--anatomy-shade-2: color-mix(in oklch, var(--muted) 20%, var(--border));
		--anatomy-shade-1: color-mix(in oklch, var(--border) 87%, var(--muted-foreground));
		--anatomy-shade-0: color-mix(in oklch, var(--border) 68%, var(--muted-foreground));
		--anatomy-lit: var(--background);
		--anatomy-ease: cubic-bezier(0.32, 0.72, 0, 1);
		--anatomy-mono: var(--font-mono, ui-monospace, monospace);
		--pc-cast: color-mix(in oklch, var(--border) 79%, var(--muted-foreground));
		--pc-well: color-mix(in oklch, var(--border) 84%, var(--muted-foreground));
		--pc-vent: color-mix(in oklch, var(--border) 47%, var(--muted-foreground));
		--pc-floor: color-mix(in oklch, var(--border) 95%, var(--muted-foreground));
		--pc-rim: var(--muted);
		--pc-ink: color-mix(in oklch, var(--foreground) 80%, var(--background));
		--pc-ink-soft: var(--muted-foreground);
		--pc-glass: color-mix(in oklch, var(--foreground) 97%, var(--background));
		--pc-glass-off: var(--foreground);
		--pc-pit: color-mix(in oklch, var(--foreground) 70%, black);
		--pc-lip: var(--pc-ink);
		/* The light theme's --chart-1. It is fixed here because the dark theme's is blue. */
		--pc-accent: oklch(0.646 0.222 41.116);
	}

	/* The translucent dark border cannot carry a solid shade, so the dark tones mix the
	   card, muted and background colours instead. */
	:global(.dark) .desk-computer {
		--anatomy-top: color-mix(in oklch, var(--card) 38%, var(--muted));
		--anatomy-shade-3: color-mix(in oklch, var(--muted) 87%, var(--muted-foreground));
		--anatomy-shade-2: color-mix(in oklch, var(--card) 53%, var(--muted));
		--anatomy-shade-1: color-mix(in oklch, var(--card) 71%, var(--background));
		--anatomy-shade-0: color-mix(in oklch, var(--card) 42%, var(--background));
		--anatomy-lit: var(--foreground);
		--pc-cast: color-mix(in oklch, var(--card) 13%, var(--background));
		--pc-well: var(--anatomy-shade-0);
		--pc-vent: color-mix(in oklch, var(--background) 70%, black);
		--pc-floor: color-mix(in oklch, var(--card) 85%, var(--background));
		--pc-rim: color-mix(in oklch, var(--muted) 75%, var(--muted-foreground));
		--pc-ink: color-mix(in oklch, var(--muted-foreground) 80%, var(--background));
		--pc-ink-soft: color-mix(in oklch, var(--muted) 66%, var(--muted-foreground));
		--pc-glass: var(--pc-vent);
		--pc-glass-off: color-mix(in oklch, var(--background) 55%, black);
		--pc-pit: color-mix(in oklch, var(--background) 43%, black);
		--pc-lip: var(--pc-floor);
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
		/* Sits under a solid's faces, so the seams between them show a face tone. */
		.iso-fill {
			fill: var(--anatomy-shade-1);
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
		[data-accent] {
			--anatomy-top: var(--pc-accent);
			--anatomy-shade-3: color-mix(in oklch, var(--pc-accent) 90%, black);
			--anatomy-shade-2: color-mix(in oklch, var(--pc-accent) 84%, black);
			--anatomy-shade-1: color-mix(in oklch, var(--pc-accent) 78%, black);
			--anatomy-shade-0: color-mix(in oklch, var(--pc-accent) 70%, black);
		}

		.pc-cast,
		.pc-print {
			fill: var(--pc-cast);
		}
		.pc-well,
		.pc-screw {
			fill: var(--pc-well);
		}
		.pc-vent,
		.pc-eject {
			fill: var(--pc-vent);
		}
		.pc-groove {
			fill: var(--anatomy-shade-0);
		}
		.pc-groove-floor {
			fill: var(--pc-floor);
		}
		.pc-led {
			fill: var(--pc-ink);
			transition: opacity 0.4s var(--anatomy-ease);
		}
		.pc-cord {
			fill: none;
			stroke: var(--pc-ink);
			stroke-width: 1.5;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
		.pc-cord[data-side='back'] {
			stroke: var(--pc-ink-soft);
		}

		/* A recess paints its opening in the colour of its back plane, then the two walls
		   the viewer sees, then the back plane itself. */
		.pc-bezel,
		.pc-recess-bezel > g > .pc-floor {
			fill: var(--anatomy-top);
		}
		.pc-recess-bezel > .pc-wall[data-face='up'] {
			fill: var(--pc-rim);
		}
		.pc-recess-bezel > .pc-wall[data-face='side'] {
			fill: var(--anatomy-shade-0);
		}
		.pc-dark,
		.pc-recess-crt > g > .pc-floor,
		.pc-recess-slot > g > .pc-floor {
			fill: var(--pc-glass);
		}
		.pc-recess-crt > .pc-wall[data-face='up'],
		.pc-recess-slot > .pc-wall {
			fill: var(--pc-lip);
		}
		.pc-recess-crt > .pc-wall[data-face='side'] {
			fill: var(--pc-pit);
		}
		.pc-glass {
			fill: var(--pc-glass-off);
			transition: fill 0.5s var(--anatomy-ease);
		}
		.pc-glass[data-on] {
			fill: var(--pc-glass);
		}
		.pc-sheen {
			fill: color-mix(in oklch, var(--anatomy-lit) 4%, transparent);
		}
		/* The mark keeps static/logo.svg's proportions: stroke 2 on a 24 unit glyph. */
		.pc-logo {
			fill: none;
			stroke: var(--anatomy-lit);
			stroke-width: 2;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
		.pc-text {
			fill: color-mix(in oklch, var(--anatomy-lit) 78%, var(--pc-glass));
			font-family: var(--anatomy-mono);
			letter-spacing: 0.02em;
		}
		.pc-cursor {
			fill: var(--pc-accent);
		}
		/* Blinks only while the tour types or shortly after a click; idle, it holds still. */
		.pc-cursor[data-blink] {
			animation: desk-computer-blink 1.06s steps(1, end) infinite;
		}
		.pc-beam {
			fill: none;
			stroke: var(--anatomy-lit);
			stroke-width: 1.2;
			stroke-linecap: round;
		}
		.pc-dot {
			fill: var(--anatomy-lit);
		}
		.pc-key,
		.pc-computer {
			cursor: pointer;
		}
		.pc-key[data-down] .iso-top {
			fill: var(--anatomy-shade-1);
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
