// Pricing page uses useCustomer() for billing-dependent UI (plan badges, manage/upgrade buttons).
// Autumn state doesn't recover on prerendered pages (page.data.autumnState frozen at build time).
export const prerender = false;
