import { componentsGeneric } from "convex/server";

export type Components = {
  "agent": import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  "autumn": import("@useautumn/convex/_generated/component.js").ComponentApi<"autumn">;
  "betterAuth": import("../../convex-components/betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
  "convexFilesControl": import("@gilhrpenner/convex-files-control/_generated/component.js").ComponentApi<"convexFilesControl">;
  "rateLimiter": import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  "resend": import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
};

export const components: Components = componentsGeneric() as any;
