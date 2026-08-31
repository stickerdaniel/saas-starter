import { describe, expect, it } from 'vitest';
import { streamingTextAnimation } from './streaming-animation.js';

describe('streamingTextAnimation', () => {
	it('mounts animated spans for a live stream', () => {
		expect(streamingTextAnimation(true)).toEqual({
			enabled: true,
			animateOnMount: true
		});
	});

	it('keeps completed history static', () => {
		expect(streamingTextAnimation(false)).toEqual({
			enabled: false,
			animateOnMount: false
		});
	});
});
