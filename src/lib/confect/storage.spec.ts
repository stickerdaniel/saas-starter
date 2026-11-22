import { FunctionSpec, GroupSpec } from '@confect/core';
import type { generateUploadUrl, updateProfileImage } from './storage';

export default GroupSpec.make()
	.addFunction(FunctionSpec.convexPublicMutation<typeof generateUploadUrl>()('generateUploadUrl'))
	.addFunction(
		FunctionSpec.convexPublicMutation<typeof updateProfileImage>()('updateProfileImage')
	);
