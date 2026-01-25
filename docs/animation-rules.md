# Animation Rules

Always follow these rules when implementing animations.

## Accessibility: Reduced Motion

Always respect user preferences for reduced motion:

```css
/* CSS approach - wrap animations */
@media (prefers-reduced-motion: no-preference) {
	.animated-element {
		transition: transform 0.3s ease-out;
	}
}

/* Or disable for those who prefer reduced motion */
@media (prefers-reduced-motion: reduce) {
	.animated-element {
		animation: none;
		transition: none;
	}
}
```

```svelte
<!-- Svelte approach - check preference -->
<script>
	import { browser } from '$app/environment';

	const prefersReducedMotion = browser
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false;
</script>

{#if !prefersReducedMotion}
	<div transition:fade>Animated content</div>
{:else}
	<div>Static content</div>
{/if}
```

**Key principles:**

- Use `prefers-reduced-motion: reduce` media query
- Provide instant alternatives (no animation, or very subtle)
- Never disable essential functionality, only decorative motion
- Test with "Reduce motion" enabled in OS accessibility settings

## When to Animate

**Do animate:**

- Enter/exit transitions for spatial consistency
- State changes that benefit from visual continuity
- Responses to user actions (feedback)
- Rarely-used interactions where delight adds value

**Don't animate:**

- Keyboard-initiated actions
- Hover effects on frequently-used elements
- Anything users interact with 100+ times daily
- When speed matters more than smoothness

## Easing decision flowchart

```text
Is the element entering or exiting the viewport?
├── Yes → ease-out
└── No
    ├── Is it moving or morphing on screen?
    │   └── Yes → ease-in-out
    └── Is it a hover change?
        ├── Yes → ease or cubic-bezier (0.19, 1, 0.22, 1) or cubic-bezier(0.785, 0.135, 0.15, 0.86) (don't forget to support focus-visible!)
        └── Is it constant motion?
            ├── Yes → linear
            └── Default → ease-out
```
