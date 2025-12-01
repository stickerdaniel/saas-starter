/**
 * Smooth text rendering for streaming messages
 *
 * Gradually reveals text character by character for a smooth streaming effect.
 * Similar to the React useSmoothText hook from @convex-dev/agent/react.
 */
export function createSmoothText(initialText: string = '') {
	let targetText = $state(initialText);
	let visibleText = $state('');
	let isAnimating = $state(false);
	let animationFrame: number | null = null;

	// Configuration
	const charsPerFrame = 2; // Characters to reveal per animation frame
	const frameDelay = 16; // ~60fps

	function startAnimation() {
		if (isAnimating) return;

		isAnimating = true;
		let currentIndex = visibleText.length;

		function animate() {
			if (currentIndex >= targetText.length) {
				isAnimating = false;
				animationFrame = null;
				return;
			}

			// Reveal next chunk of characters
			const nextIndex = Math.min(currentIndex + charsPerFrame, targetText.length);
			visibleText = targetText.slice(0, nextIndex);
			currentIndex = nextIndex;

			// Schedule next frame
			animationFrame = window.setTimeout(() => {
				animate();
			}, frameDelay);
		}

		animate();
	}

	function stopAnimation() {
		if (animationFrame !== null) {
			window.clearTimeout(animationFrame);
			animationFrame = null;
		}
		isAnimating = false;
	}

	function updateText(newText: string) {
		targetText = newText;

		// If new text is shorter, instantly update visible text
		if (newText.length < visibleText.length) {
			visibleText = newText;
			stopAnimation();
		}
		// If new text is longer, start animation
		else if (newText.length > visibleText.length) {
			startAnimation();
		}
	}

	function reset() {
		stopAnimation();
		targetText = '';
		visibleText = '';
	}

	function skipToEnd() {
		stopAnimation();
		visibleText = targetText;
	}

	return {
		get visible() {
			return visibleText;
		},
		get target() {
			return targetText;
		},
		get isAnimating() {
			return isAnimating;
		},
		updateText,
		reset,
		skipToEnd
	};
}
