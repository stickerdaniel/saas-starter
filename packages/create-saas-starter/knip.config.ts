import type { KnipConfig } from 'knip';

export default {
	entry: ['src/index.ts', 'test/**/*.test.ts'],
	project: ['src/**/*.ts', 'scripts/**/*.ts', 'test/**/*.ts'],
	ignoreExportsUsedInFile: true,
	ignoreIssues: { 'src/target.ts': ['exports'] }
} satisfies KnipConfig;
