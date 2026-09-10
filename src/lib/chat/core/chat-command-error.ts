export type ChatCommandErrorCode = 'empty_input' | 'send_in_progress';

/** Expected validation refusal from a local chat command. */
export class ChatCommandError extends Error {
	readonly code: ChatCommandErrorCode;

	constructor(code: ChatCommandErrorCode) {
		super(code);
		this.name = 'ChatCommandError';
		this.code = code;
	}
}
