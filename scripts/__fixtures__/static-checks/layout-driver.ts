import { runStaticChecks } from '../../static-checks';
import { WORKSPACE_CHECK_LAYOUT } from './workspace-layout';

process.exitCode = 2;
await runStaticChecks(WORKSPACE_CHECK_LAYOUT);
