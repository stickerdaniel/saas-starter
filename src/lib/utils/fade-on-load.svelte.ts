/**
 * FadeOnLoad - Reusable fade-in animation state manager for Convex queries
 *
 * Tracks loading state and provides animation classes that only trigger
 * on the first successful data load, preventing re-animations on subsequent updates.
 *
 * @example
 * ```typescript
 * // In a context class
 * threadsFade = new FadeOnLoad<ThreadSummary[]>();
 *
 * async loadThreads(client: ConvexClient) {
 *   this.threadsFade.setLoading(true);
 *   const result = await client.query(...);
 *   this.threadsFade.setData(result.page);
 *   this.threadsFade.setLoading(false);
 * }
 *
 * // In a component
 * <div class={ctx.threadsFade.animationClass}>
 *   {#each ctx.threads as thread}...{/each}
 * </div>
 * ```
 */
export class FadeOnLoad<T = unknown> {
	private _isLoading = $state(false);
	private _hasLoadedOnce = $state(false);
	private _animationClasses: string;

	constructor(animationClasses = 'animate-in fade-in-0 duration-200') {
		this._animationClasses = animationClasses;
	}

	/** Whether data is currently loading */
	get isLoading(): boolean {
		return this._isLoading;
	}

	/** Whether data has been loaded at least once */
	get hasLoadedOnce(): boolean {
		return this._hasLoadedOnce;
	}

	/**
	 * Animation class string - only returns classes on first load completion
	 * Returns empty string after first animation to prevent re-animations
	 */
	get animationClass(): string {
		return this._hasLoadedOnce ? this._animationClasses : '';
	}

	/** Set loading state */
	setLoading(loading: boolean): void {
		this._isLoading = loading;
	}

	/**
	 * Mark data as loaded - triggers the fade animation on first call
	 * Subsequent calls have no effect on animation (prevents re-animation)
	 */
	markLoaded(): void {
		if (!this._hasLoadedOnce) {
			this._hasLoadedOnce = true;
		}
	}

	/** Reset state - allows animation to trigger again on next load */
	reset(): void {
		this._hasLoadedOnce = false;
		this._isLoading = false;
	}
}
