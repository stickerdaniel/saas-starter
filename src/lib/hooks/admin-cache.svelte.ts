class AdminCacheManager {
	userCount = $state<number | null>(null);
}

export const adminCache = new AdminCacheManager();
