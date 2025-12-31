import { Context } from 'runed';

export type MessageSchema = Record<string, unknown>;

export class MessageClass {
	// Placeholder for shared state management
	// Currently the Message component is mostly presentational
	// but this allows for future extensibility

	constructor(_props?: MessageSchema) {
		// Initialize any shared state here if needed
	}
}

export const messageContext = new Context<MessageClass>('message');
