import { Context, watch } from 'runed';
import type { ReadableBoxedValues, WritableBoxedValues } from 'svelte-toolbelt';
import type { ZxcvbnResult } from '@zxcvbn-ts/core';

type ZxcvbnRunner = (typeof import('@zxcvbn-ts/core'))['zxcvbn'];

/** Tracks whether zxcvbn is ready. Reactive via $state. */
let dictionariesLoaded = $state(false);
let zxcvbnRunner: ZxcvbnRunner | null = null;
let loadPromise: Promise<ZxcvbnRunner> | null = null;

function loadZxcvbn(): Promise<ZxcvbnRunner> {
	if (loadPromise) return loadPromise;
	loadPromise = Promise.all([
		import('@zxcvbn-ts/core'),
		import('@zxcvbn-ts/language-common'),
		import('@zxcvbn-ts/language-en')
	])
		.then(([core, common, en]) => {
			core.zxcvbnOptions.setOptions({
				translations: en.translations,
				graphs: common.adjacencyGraphs,
				dictionary: {
					...common.dictionary,
					...en.dictionary
				}
			});
			zxcvbnRunner = core.zxcvbn;
			dictionariesLoaded = true;
			return core.zxcvbn;
		})
		.catch((error: unknown) => {
			loadPromise = null; // allow retry on failure
			throw error;
		});
	return loadPromise;
}

const EMPTY_RESULT: ZxcvbnResult = {
	calcTime: 0,
	crackTimesDisplay: {
		offlineFastHashing1e10PerSecond: '',
		offlineSlowHashing1e4PerSecond: '',
		onlineNoThrottling10PerSecond: '',
		onlineThrottling100PerHour: ''
	},
	crackTimesSeconds: {
		offlineFastHashing1e10PerSecond: 0,
		offlineSlowHashing1e4PerSecond: 0,
		onlineNoThrottling10PerSecond: 0,
		onlineThrottling100PerHour: 0
	},
	feedback: { warning: null, suggestions: [] },
	guesses: 0,
	guessesLog10: 0,
	password: '',
	score: 0,
	sequence: []
};

type PasswordRootStateProps = WritableBoxedValues<{
	hidden: boolean;
}> &
	ReadableBoxedValues<{
		minScore: number;
		validationMessage: string;
	}>;

type PasswordState = {
	value: string;
	copyMounted: boolean;
	toggleMounted: boolean;
	strengthMounted: boolean;
	tainted: boolean;
};

const defaultPasswordState: PasswordState = {
	value: '',
	copyMounted: false,
	toggleMounted: false,
	strengthMounted: false,
	tainted: false
};

class PasswordRootState {
	passwordState = $state(defaultPasswordState);

	constructor(readonly opts: PasswordRootStateProps) {
		loadZxcvbn();
	}

	// Re-runs when password changes OR when dictionariesLoaded flips to true
	strength = $derived.by(() => {
		if (!dictionariesLoaded || !zxcvbnRunner) return EMPTY_RESULT;
		return zxcvbnRunner(this.passwordState.value);
	});
}

type PasswordInputStateProps = WritableBoxedValues<{
	value: string;
}> &
	ReadableBoxedValues<{
		ref: HTMLInputElement | null;
	}>;

class PasswordInputState {
	constructor(
		readonly root: PasswordRootState,
		readonly opts: PasswordInputStateProps
	) {
		watch(
			() => this.opts.value.current,
			() => {
				if (this.root.passwordState.value !== this.opts.value.current) {
					this.root.passwordState.tainted = true;
					this.root.passwordState.value = this.opts.value.current;
				}
			}
		);

		$effect(() => {
			if (!this.root.passwordState.strengthMounted) return;

			// if the password is empty, we let the `required` attribute handle the validation
			if (
				this.root.passwordState.value !== '' &&
				this.root.strength.score < this.root.opts.minScore.current
			) {
				this.opts.ref.current?.setCustomValidity(this.root.opts.validationMessage.current);
			} else {
				this.opts.ref.current?.setCustomValidity('');
			}
		});
	}

	props = $derived.by(() => ({
		'aria-invalid':
			this.root.strength.score < this.root.opts.minScore.current &&
			this.root.passwordState.tainted &&
			this.root.passwordState.strengthMounted
	}));
}

class PasswordToggleVisibilityState {
	constructor(readonly root: PasswordRootState) {
		this.root.passwordState.toggleMounted = true;

		// this way we go back to the correct padding when toggle is unmounted
		$effect(() => {
			return () => {
				this.root.passwordState.toggleMounted = false;
			};
		});
	}
}

class PasswordCopyState {
	constructor(readonly root: PasswordRootState) {
		this.root.passwordState.copyMounted = true;

		// this way we go back to the correct padding when copy is unmounted
		$effect(() => {
			return () => {
				this.root.passwordState.copyMounted = false;
			};
		});
	}
}

class PasswordStrengthState {
	constructor(readonly root: PasswordRootState) {
		this.root.passwordState.strengthMounted = true;

		$effect(() => {
			return () => {
				this.root.passwordState.strengthMounted = false;
			};
		});
	}

	get strength() {
		return this.root.strength;
	}
}

const ctx = new Context<PasswordRootState>('password-root-state');

export function usePassword(props: PasswordRootStateProps) {
	return ctx.set(new PasswordRootState(props));
}

export function usePasswordInput(props: PasswordInputStateProps) {
	return new PasswordInputState(ctx.get(), props);
}

export function usePasswordToggleVisibility() {
	return new PasswordToggleVisibilityState(ctx.get());
}

export function usePasswordCopy() {
	return new PasswordCopyState(ctx.get());
}

export function usePasswordStrength() {
	return new PasswordStrengthState(ctx.get());
}
