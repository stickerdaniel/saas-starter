import type { FSWatcher } from 'node:fs';
import { generateAuthoredContent, watchAuthoredContent } from './generate-authored-content';

type AuthoredContentLifecycle = {
	generate: () => void;
	watch: () => Pick<FSWatcher, 'close'>;
};

export function startAuthoredContentSync(
	watchEnabled: boolean,
	lifecycle: AuthoredContentLifecycle = {
		generate: generateAuthoredContent,
		watch: watchAuthoredContent
	}
): Pick<FSWatcher, 'close'> | null {
	if (watchEnabled) return lifecycle.watch();
	lifecycle.generate();
	return null;
}

export function convexDevCommand(args: string[] = process.argv.slice(2)): string[] {
	return ['convex', 'dev', ...args];
}

async function main(): Promise<void> {
	const authoredContentWatcher = startAuthoredContentSync(
		process.env.AUTHORED_CONTENT_WATCH !== '0'
	);
	const child = Bun.spawn(convexDevCommand(), {
		stdio: ['inherit', 'inherit', 'inherit'],
		env: { ...process.env }
	});

	const onSignal = (signal: NodeJS.Signals) => {
		authoredContentWatcher?.close();
		try {
			child.kill(signal);
		} catch {
			/* already dead */
		}
	};
	process.on('SIGINT', () => onSignal('SIGINT'));
	process.on('SIGTERM', () => onSignal('SIGTERM'));

	const code = await child.exited;
	authoredContentWatcher?.close();
	process.exit(code ?? 0);
}

if (import.meta.main) {
	await main();
}
