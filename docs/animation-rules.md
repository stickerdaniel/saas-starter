# Animation Rules

Always follow these rules when implementing animations.

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
        ├── Yes → ease
        └── Is it constant motion?
            ├── Yes → linear
            └── Default → ease-out
```
