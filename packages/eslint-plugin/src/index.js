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
