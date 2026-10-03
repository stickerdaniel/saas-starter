import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

/** The inline deploy-recovery script exactly as src/app.html ships it. */
function recoveryScript(): string {
	const template = readFileSync(path.resolve('src/app.html'), 'utf8');
	const bodies = [...template.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
		([, body]) => body ?? ''
	);
	const [script, ...extra] = bodies.filter((body) => body.includes('vite:preloadError'));
	if (!script || extra.length > 0) {
		throw new Error('src/app.html should own one deploy-recovery script');
	}
	return script;
}

export const PRELOAD_ATTEMPT_KEY = 'sk:preload-reloaded';

/**
 * A page shell running the real app.html recovery script before any app code.
 *
 * The host objects are stand-ins: jsdom cannot reload or navigate, so this
 * records what the script asked the browser to do instead.
 */
export function installDeployRecoveryShell(options: { onReload?: () => void } = {}) {
	const window = new EventTarget() as EventTarget & { __deployRecovery?: DeployRecovery };
	const session = new Map<string, string>();
	const departures: string[] = [];
	let reloads = 0;

	runInNewContext(recoveryScript(), {
		window,
		sessionStorage: {
			getItem: (key: string) => session.get(key) ?? null,
			setItem: (key: string, value: string) => session.set(key, String(value))
		},
		location: {
			reload() {
				reloads++;
				options.onReload?.();
			},
			set href(href: string) {
				departures.push(href);
			}
		}
	});

	return {
		window,
		recovery: window.__deployRecovery!,
		departures,
		get reloads() {
			return reloads;
		},
		/** The per-tab failed-preload attempt, as the next document would see it. */
		get attempt() {
			return session.get(PRELOAD_ATTEMPT_KEY) ?? null;
		},
		spendAttempt() {
			session.set(PRELOAD_ATTEMPT_KEY, '1');
		},
		/** What Vite's preload helper dispatches when a chunk import fails. */
		preloadError(): Event {
			const event = new Event('vite:preloadError', { cancelable: true });
			window.dispatchEvent(event);
			return event;
		}
	};
}
