import { toUIMessages } from '@convex-dev/agent';
import { describe, expect, it } from 'vitest';
import { messageRouteToShow } from './message-routes';

const THREAD_ROUTE = 'https://example.com/en/app?panel=details';
const OTHER_ROUTE = 'https://example.com/en/app/projects/p1?tab=files#section';
const OTHER_PATH = '/en/app/projects/p1';

describe('messageRouteToShow', () => {
	// The thread route describes where the conversation began, so a later
	// message written elsewhere is the one an incident has to be traced to.
	it('names the route of a message sent from another page', () => {
		const routes = new Map([['message_1', OTHER_ROUTE]]);

		expect(messageRouteToShow('message_1', routes, THREAD_ROUTE)).toBe(OTHER_PATH);
	});

	it('stays silent when the message matches the route the thread already shows', () => {
		const routes = new Map([['message_1', THREAD_ROUTE]]);

		expect(messageRouteToShow('message_1', routes, THREAD_ROUTE)).toBeUndefined();
	});

	it('stays silent for a message that carries no route', () => {
		const routes = new Map([['message_1', OTHER_ROUTE]]);

		expect(messageRouteToShow('message_2', routes, THREAD_ROUTE)).toBeUndefined();
	});

	it('stays silent for unsafe legacy routes', () => {
		const routes = new Map([['message_1', 'javascript:alert(1)']]);

		expect(messageRouteToShow('message_1', routes, THREAD_ROUTE)).toBeUndefined();
	});

	it('treats equivalent legacy URLs as one pathname', () => {
		const routes = new Map([['message_1', 'https://old.example/en/app?old=1']]);

		expect(messageRouteToShow('message_1', routes, '/en/app?new=1')).toBeUndefined();
	});

	// Threads created before the widget started sending a route have no pageUrl,
	// and there a message route is the only answer available.
	it('names the route when the thread has none', () => {
		const routes = new Map([['message_1', OTHER_ROUTE]]);

		expect(messageRouteToShow('message_1', routes, undefined)).toBe(OTHER_PATH);
	});

	it('matches a context row to the persisted admin message id', () => {
		const [adminMessage] = toUIMessages([
			{
				_id: 'message_1',
				_creationTime: 1,
				order: 0,
				stepOrder: 0,
				status: 'success',
				threadId: 'thread_1',
				tool: false,
				message: { role: 'user', content: 'The map is blank' }
			}
		] as any);
		const routes = new Map([['message_1', OTHER_ROUTE]]);

		expect(adminMessage?.id).toBe('message_1');
		expect(messageRouteToShow(adminMessage!.id, routes, THREAD_ROUTE)).toBe(OTHER_PATH);
	});
});
