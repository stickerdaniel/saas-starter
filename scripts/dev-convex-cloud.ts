import { watchAuthoredContent } from './generate-authored-content';

export function convexDevCommand(args: string[] = process.argv.slice(2)): string[] {
	return ['convex', 'dev', ...args];
}

async function main(): Promise<void> {
	const authoredContentWatcher =
		process.env.AUTHORED_CONTENT_WATCH === '0' ? null : watchAuthoredContent();
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
