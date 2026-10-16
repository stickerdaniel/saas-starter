export const sharedTestSettings = {
	exclude: [
		'e2e/**',
		'**/node_modules/**',
		'dist/**',
		'.{idea,git,cache,output,temp}/**',
		'docs/**',
		'scratch/**',
		'.opencode/**',
		'references/**',
		// Agent worktrees and symlinked skills are copies of owned tests.
		// Discover the originals, including .agents/skills/, only once.
		'.claude/**',
		// The creator package has its own Vitest project and root command.
		'packages/create-saas-starter/test/**',
		// Repository-spawning detector tests run in their own CI job.
		'.agents/skills/upstream-report/scripts/upstream-relevance.integration.test.ts'
	],
	passWithNoTests: true,
	// Svelte's async tick() resolves on the next animation frame. Faking that
	// frame leaves the callback queued forever in jsdom, so timer tests keep
	// the real frame (installed for this runner in the app setup) and only
	// fake the timers they advance.
	fakeTimers: {
		toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as [
			'setTimeout',
			'clearTimeout',
			'setInterval',
			'clearInterval',
			'Date'
		]
	}
};

export const toolingTestSettings = {
	name: 'tooling',
	environment: 'node',
	exclude: ['src/**']
};
