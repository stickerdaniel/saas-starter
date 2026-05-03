/** Longest-side cap applied to images before WebP encode. */
export const MAX_IMAGE_WIDTH = 2048;

/** WebP quality 0–100. 85 balances size against text/edge fidelity for screenshots. */
export const WEBP_QUALITY = 85;

/** Mime types that bypass the encode pipeline entirely. */
export const PASSTHROUGH_MIMES: ReadonlySet<string> = new Set(['image/svg+xml']);
