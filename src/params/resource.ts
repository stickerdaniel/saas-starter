import { isResourceName } from '$lib/admin/registry';

export function match(param: string) {
	return isResourceName(param);
}
