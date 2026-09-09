import type { PageServerLoad } from './$types';
import { resolvePublicCapabilityData } from '$lib/server/auth-layout-data';

export const load: PageServerLoad = async (event) => resolvePublicCapabilityData(event);
