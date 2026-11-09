<!--
  Decorative isometric desk computer that types the saas-starter CLI commands.
  The figure comes from anatomy (MIT); desk-computer.svg records its provenance.
-->
<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import frame from 'virtual:desk-computer-frame.css?url';

	let { class: className = '' }: { class?: string } = $props();

	// The head links a render-blocking stylesheet that paints the figure as an image, so it
	// arrives with the page without its markup in the HTML (scripts/desk-computer-frame.ts).
	// The live markup and its animation load after the page's load event once the browser is
	// idle, off the critical path.
	const animate: Attachment<HTMLDivElement> = (host) => {
		let destroyed = false;
		let stop: (() => void) | undefined;
		let idleId: number | undefined;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		async function start() {
			const { animateDeskComputer, markup } = await import('./desk-computer.js');
			if (destroyed) return;
			// Filling the host ends the stylesheet frame in the same task, so no frame paints
			// both figures or neither.
			host.innerHTML = markup;
			const svg = host.querySelector('svg');
			if (svg) stop = animateDeskComputer(svg);
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

<svelte:head>
	<link rel="stylesheet" href={frame} />
</svelte:head>

<div class={['desk-computer', className]} aria-hidden="true" {@attach animate}></div>

<style>
	/* The figure has no outlines, its faces are fills in tones derived from the app theme:
	   faces toward the viewer take the muted tone, tops the border grey, and the faces
	   turned away step darker. The screen follows the theme. */
	.desk-computer {
		--anatomy-top: var(--border);
		--anatomy-shade-3: var(--muted);
		--anatomy-shade-2: color-mix(in oklch, var(--border) 95%, var(--muted-foreground));
		--anatomy-shade-1: color-mix(in oklch, var(--border) 68%, var(--muted-foreground));
		--anatomy-shade-0: color-mix(in oklch, var(--border) 42%, var(--muted-foreground));
		--anatomy-ease: cubic-bezier(0.32, 0.72, 0, 1);
		--anatomy-mono: var(--font-mono, ui-monospace, monospace);
		--pc-cast: color-mix(in oklch, var(--border) 53%, var(--muted-foreground));
		--pc-well: var(--anatomy-shade-1);
		--pc-vent: color-mix(in oklch, var(--border) 10%, var(--muted-foreground));
		--pc-floor: color-mix(in oklch, var(--border) 84%, var(--muted-foreground));
		--pc-rim: color-mix(in oklch, var(--muted) 50%, var(--border));
		--pc-ink: color-mix(in oklch, var(--foreground) 80%, var(--background));
		--pc-ink-soft: var(--muted-foreground);
		--pc-slot: color-mix(in oklch, var(--foreground) 97%, var(--background));
		--pc-slot-lip: var(--pc-ink);
		--pc-screen: var(--background);
		--pc-screen-off: color-mix(in oklch, var(--border) 85%, var(--muted-foreground));
		--pc-screen-lip: var(--anatomy-shade-2);
		--pc-screen-pit: var(--anatomy-shade-1);
		--pc-pixel: var(--foreground);
		/* The light theme's --chart-1. It is fixed here because the dark theme's is blue. */
		--pc-accent: oklch(0.646 0.222 41.116);
	}

	/* The translucent dark border cannot carry a solid shade, so the dark tones mix the
	   card, muted and background colours instead. */
	:global(.dark) .desk-computer {
		--anatomy-top: var(--card);
		--anatomy-shade-3: color-mix(in oklch, var(--muted) 96%, var(--muted-foreground));
		--anatomy-shade-2: color-mix(in oklch, var(--card) 85%, var(--background));
		--anatomy-shade-1: var(--background);
		--anatomy-shade-0: color-mix(in oklch, var(--background) 82%, black);
		--pc-cast: color-mix(in oklch, var(--background) 70%, black);
		--pc-well: color-mix(in oklch, var(--background) 92%, black);
		--pc-vent: color-mix(in oklch, var(--background) 50%, black);
		--pc-floor: color-mix(in oklch, var(--card) 28%, var(--background));
		--pc-rim: color-mix(in oklch, var(--muted) 75%, var(--muted-foreground));
		--pc-ink: color-mix(in oklch, var(--muted-foreground) 80%, var(--background));
		--pc-ink-soft: color-mix(in oklch, var(--muted) 66%, var(--muted-foreground));
		--pc-slot: color-mix(in oklch, var(--background) 70%, black);
		--pc-slot-lip: var(--anatomy-shade-2);
		--pc-screen: var(--pc-slot);
		--pc-screen-off: color-mix(in oklch, var(--background) 55%, black);
		--pc-screen-pit: color-mix(in oklch, var(--background) 43%, black);
	}

	/* The injected SVG is not part of this component's markup, so its rules are global
	   below the scoped wrapper. The stylesheet frame embeds these rules and the tokens above. */
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
		.pc-recess-slot > g > .pc-floor {
			fill: var(--pc-slot);
		}
		.pc-recess-slot > .pc-wall {
			fill: var(--pc-slot-lip);
		}
		.pc-recess-crt > g > .pc-floor {
			fill: var(--pc-screen);
		}
		.pc-recess-crt > .pc-wall[data-face='up'] {
			fill: var(--pc-screen-lip);
		}
		.pc-recess-crt > .pc-wall[data-face='side'] {
			fill: var(--pc-screen-pit);
		}
		.pc-glass {
			fill: var(--pc-screen-off);
			transition: fill 0.5s var(--anatomy-ease);
		}
		.pc-glass[data-on] {
			fill: var(--pc-screen);
		}
		.pc-sheen {
			fill: color-mix(in oklch, var(--pc-pixel) 4%, transparent);
		}
		/* The mark keeps static/logo.svg's proportions: stroke 2 on a 24 unit glyph. */
		.pc-logo {
			fill: none;
			stroke: var(--pc-pixel);
			stroke-width: 2;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
		/* SVG text collapses a trailing space; `pre` keeps it, so the cursor sits behind it. */
		.pc-text {
			fill: color-mix(in oklch, var(--pc-pixel) 78%, var(--pc-screen));
			font-family: var(--anatomy-mono);
			letter-spacing: 0.02em;
			white-space: pre;
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
			stroke: var(--pc-pixel);
			stroke-width: 1.2;
			stroke-linecap: round;
		}
		.pc-dot {
			fill: var(--pc-pixel);
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
