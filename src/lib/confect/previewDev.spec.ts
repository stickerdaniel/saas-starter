import { FunctionSpec, GroupSpec } from '@confect/core';
import type { ensurePreviewAdmin } from './previewDev';

export default GroupSpec.make().addFunction(
	FunctionSpec.convexInternalMutation<typeof ensurePreviewAdmin>()('ensurePreviewAdmin')
);
