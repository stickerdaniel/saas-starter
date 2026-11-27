import type { KnipConfig } from 'knip';

export default {
	entry: ['src/index.ts', 'test/**/*.test.ts'],
	project: ['src/**/*.ts', 'scripts/**/*.ts', 'test/**/*.ts'],
	// The creator's tests parse YAML; a template without them keeps the package.
	ignoreDependencies: ['yaml'],
	ignoreExportsUsedInFile: true,
	ignoreIssues: { 'src/target.ts': ['exports'] }
} satisfies KnipConfig;
