import effectLeafImports from './rules/effect-leaf-imports.js';
import effectNoManualRetry from './rules/effect-no-manual-retry.js';
import effectNoPromiseRace from './rules/effect-no-promise-race.js';
import effectNoRawTimers from './rules/effect-no-raw-timers.js';
import effectNoTryInGen from './rules/effect-no-try-in-gen.js';
import effectRunBoundary from './rules/effect-run-boundary.js';
import effectSubpathImport from './rules/effect-subpath-import.js';
import effectTaggedErrors from './rules/effect-tagged-errors.js';
import noBareTestSkip from './rules/no-bare-test-skip.js';
import noDynamicImportRejectionHandler from './rules/no-dynamic-import-rejection-handler.js';
import noLiteralControlChar from './rules/no-literal-control-char.js';
import noModuleStateSingleton from './rules/no-module-state-singleton.js';
import noNetworkidleWait from './rules/no-networkidle-wait.js';
import requireCustomRegistrarArgs from './rules/require-custom-registrar-args.js';
import requireExplicitStorageState from './rules/require-explicit-storage-state.js';
import requireMotionGuardTransition from './rules/require-motion-guard-transition.js';
import requireReturnsValidator from './rules/require-returns-validator.js';
import requireSvelteModuleExtension from './rules/require-svelte-module-extension.js';

/**
 * ESLint plugin. Register it under any plugin key; the template uses `local`, so its rule ids
 * read `local/<rule>`:
 *
 *   plugins: { local: { rules: { ...plugin.rules } } }
 */
export default {
	meta: { name: 'eslint-plugin-saas-starter', version: '0.0.0' },
	rules: {
		'effect-leaf-imports': effectLeafImports,
		'effect-no-manual-retry': effectNoManualRetry,
		'effect-no-promise-race': effectNoPromiseRace,
		'effect-no-raw-timers': effectNoRawTimers,
		'effect-no-try-in-gen': effectNoTryInGen,
		'effect-run-boundary': effectRunBoundary,
		'effect-subpath-import': effectSubpathImport,
		'effect-tagged-errors': effectTaggedErrors,
		'no-bare-test-skip': noBareTestSkip,
		'no-dynamic-import-rejection-handler': noDynamicImportRejectionHandler,
		'no-literal-control-char': noLiteralControlChar,
		'no-module-state-singleton': noModuleStateSingleton,
		'no-networkidle-wait': noNetworkidleWait,
		'require-custom-registrar-args': requireCustomRegistrarArgs,
		'require-explicit-storage-state': requireExplicitStorageState,
		'require-motion-guard-transition': requireMotionGuardTransition,
		'require-returns-validator': requireReturnsValidator,
		'require-svelte-module-extension': requireSvelteModuleExtension
	}
};
