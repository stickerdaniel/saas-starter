import { Context } from 'runed';

export class ReasoningContext {
	#isStreaming = $state(false);
	#isOpen = $state(true);
	#duration = $state(0);
	#hasContent = $state(false);

	constructor(
		options: {
			isStreaming?: boolean;
			isOpen?: boolean;
			duration?: number;
			hasContent?: boolean;
		} = {}
	) {
		this.#isStreaming = options.isStreaming ?? false;
		this.#isOpen = options.isOpen ?? true;
		this.#duration = options.duration ?? 0;
		this.#hasContent = options.hasContent ?? false;
	}

	get isStreaming() {
		return this.#isStreaming;
	}

	set isStreaming(value: boolean) {
		this.#isStreaming = value;
	}

	get isOpen() {
		return this.#isOpen;
	}

	set isOpen(value: boolean) {
		this.#isOpen = value;
	}

	get duration() {
		return this.#duration;
	}

	set duration(value: number) {
		this.#duration = value;
	}

	get hasContent() {
		return this.#hasContent;
	}

	set hasContent(value: boolean) {
		this.#hasContent = value;
	}

	setIsOpen(open: boolean) {
		this.#isOpen = open;
	}
}

export const reasoningContext = new Context<ReasoningContext>('reasoning');
