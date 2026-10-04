// Build-time third-party notices. Collection (the Vite plugins), resolution,
// and serialization are separate so a fork that ships another runtime can
// resolve and serialize its own inputs after staging it.
// See docs/decisions/2026-10-04-third-party-license-notices.md.
export { thirdPartyLicenses, type ThirdPartyLicensesOptions } from './collect';
export { loadThirdPartyLicensesConfig } from './config';
export { resolveThirdPartyNotices, type ShippedInput } from './resolve';
export { buildCatalogue, serializeCatalogueJson, serializeCatalogueText } from './serialize';
