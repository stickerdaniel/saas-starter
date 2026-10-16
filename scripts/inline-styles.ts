/**
 * SvelteKit's `inlineStyleThreshold`: a client stylesheet shorter than this many
 * characters ships inside the document instead of as a blocking request.
 *
 * It is sized to inline the shared stylesheet on full document loads, which favors
 * first paint over caching that file. A sheet that grows past it is linked again
 * without any error, so the post-build check warns about it.
 */
export const INLINE_STYLE_THRESHOLD = 256 * 1024;
