import { watchAuthoredContent } from './generate-authored-content';

const authoredContentWatcher = watchAuthoredContent();
const child = Bun.spawn(['convex', 'dev'], {
	stdio: ['inherit', 'inherit', 'inherit'],
	env: { ...process.env }
});

const onSignal = (signal: NodeJS.Signals) => {
	authoredContentWatcher.close();
	try {
		child.kill(signal);
	} catch {
		/* already dead */
	}
};
process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

const code = await child.exited;
authoredContentWatcher.close();
process.exit(code ?? 0);
