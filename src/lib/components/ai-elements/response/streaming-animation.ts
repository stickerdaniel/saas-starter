import type { StreamdownProps } from 'svelte-streamdown';

type Animation = NonNullable<StreamdownProps['animation']>;

/**
 * Configure Streamdown for a live response without replaying settled history.
 *
 * The locked 3.0.1 dependency leaves its animated-text context unmounted when
 * `animateOnMount` is omitted, even if `enabled` is true. The result is plain
 * text on first render and after appended chunks, so the transition CSS has no
 * spans to target. A live item mounts with both flags; a completed item keeps
 * animation disabled and therefore stays static when a thread is reopened.
 */
export function streamingTextAnimation(isStreaming: boolean): Animation {
	return isStreaming
		? { enabled: true, animateOnMount: true }
		: { enabled: false, animateOnMount: false };
}
