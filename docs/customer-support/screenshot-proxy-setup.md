# SnapDOM CORS Proxy Setup Guide

This guide walks you through setting up a Cloudflare Worker to proxy external images for screenshot capture with snapDOM.

## Table of Contents

- [Do You Need This?](#do-you-need-this)
- [How It Works](#how-it-works)
- [Security Considerations](#security-considerations)
- [Quick Setup](#quick-setup)
- [Step-by-Step Instructions](#step-by-step-instructions)
- [Environment Configuration](#environment-configuration)
- [Testing](#testing)
- [Cost Estimates](#cost-estimates)
- [Troubleshooting](#troubleshooting)

## Do You Need This?

**You DON'T need this proxy if:**

- Your screenshots only capture same-origin content (your own website)
- External images already have proper CORS headers
- You're only developing locally (dev mode uses public proxy automatically)

**You DO need this proxy if:**

- Screenshots include external images from third-party domains (e.g., `html.tailus.io`, CDNs)
- Those external domains don't send `Access-Control-Allow-Origin` headers
- You want production-grade reliability and security (vs. public proxies)

**Development Note:** In development mode, the app automatically uses a public CORS proxy (`corsproxy.io`) for convenience. You don't need to set up anything for local development.

## How It Works

```
┌─────────────┐
│   Browser   │
│ (snapDOM)   │
└──────┬──────┘
       │
       │ 1. Fetch external image blocked by CORS
       ▼
┌──────────────────────┐
│  Your Application    │
│  (localhost:5173)    │
└──────┬───────────────┘
       │
       │ 2. Request via proxy
       ▼
┌──────────────────────┐
│ Cloudflare Worker    │
│ (img-proxy.yourdom)  │
└──────┬───────────────┘
       │
       │ 3. Fetch from origin
       ▼
┌──────────────────────┐
│  External Domain     │
│  (tailus.io, etc.)   │
└──────────────────────┘
       │
       │ 4. Response with CORS headers
       ▼
┌──────────────────────┐
│  snapDOM receives    │
│  image data          │
└──────────────────────┘
```

**Key Features:**

- **Domain Whitelisting** - Only proxies from trusted domains you specify
- **Origin Restrictions** - Only your domain can use the proxy
- **Automatic Caching** - Cloudflare caches images at the edge for 24 hours
- **File Size Limits** - Prevents bandwidth abuse (10MB default)
- **CORS Headers** - Adds proper headers for browser compatibility

## Security Considerations

### Risks of Public Proxies

❌ **Don't use public proxies in production:**

- Third-party sees all your traffic
- Screenshots may contain sensitive user data
- Services can go down without notice
- No rate limiting or abuse protection
- Potential for content modification/injection

### Benefits of Your Own Proxy

✅ **Why run your own:**

- Full control over data privacy
- Predictable uptime and performance
- Domain whitelisting prevents abuse
- Cloudflare's enterprise-grade infrastructure
- Free tier covers most use cases

### Security Best Practices

1. **Whitelist Only Trusted Domains** - Update `ALLOWED_DOMAINS` in worker code
2. **Restrict Origins** - Set `ALLOWED_ORIGINS` to your production domain only
3. **Monitor Usage** - Check Cloudflare analytics for unusual patterns
4. **Set File Size Limits** - Default 10MB prevents abuse
5. **Remove Localhost in Production** - Remove dev origins before deploying

## Quick Setup

**5-Minute Setup:**

1. Copy worker code from `docs/screenshot-proxy-worker.js`
2. Create Cloudflare Worker at https://workers.cloudflare.com
3. Update `ALLOWED_DOMAINS` and `ALLOWED_ORIGINS` in worker code
4. Deploy worker
5. Add custom domain (e.g., `img-proxy.yourdomain.com`)
6. Set `PUBLIC_SNAPDOM_PROXY_URL` in Vercel environment variables
7. Test and deploy!

## Step-by-Step Instructions

### 1. Create Cloudflare Account

1. Go to https://workers.cloudflare.com
2. Sign up or log in (free tier is sufficient)
3. Verify your email

### 2. Create Worker

1. Click **Create a Worker** or **Create a Service**
2. Give it a name: `snapdom-proxy` or `screenshot-proxy`
3. Click **Create Service** / **Quick Edit**

### 3. Configure Worker Code

1. Open `docs/screenshot-proxy-worker.js` in your project
2. Update the configuration section:

```javascript
// Update these arrays with your actual domains
const ALLOWED_DOMAINS = [
	'html.tailus.io', // Add domains you want to proxy
	'images.unsplash.com',
	'your-cdn.example.com'
];

const ALLOWED_ORIGINS = [
	'https://yourdomain.com', // Your production domain
	'https://www.yourdomain.com'
	// Remove localhost entries before production deployment
];
```

3. Copy the **entire updated code**
4. Paste into Cloudflare Worker editor
5. Click **Save and Deploy**

### 4. Add Custom Domain (Recommended)

**Why:** Custom domains hide the proxy nature and are more professional.

1. In your worker dashboard, go to **Triggers** tab
2. Click **Add Custom Domain**
3. Enter subdomain: `img-proxy.yourdomain.com` (or any subdomain you prefer)
4. Click **Add Custom Domain**

**Important:** Don't use obvious names like `cors-proxy`, `proxy`, or `bypass` as they might trigger ad blockers.

**DNS Configuration:**

- Cloudflare automatically adds DNS records if your domain is on Cloudflare
- If not, add a CNAME record pointing to your worker's `*.workers.dev` URL

### 5. Test Your Worker

Test the proxy is working correctly:

```bash
# Replace with your worker URL
curl "https://img-proxy.yourdomain.com/?url=https://html.tailus.io/blocks/customers/column.svg" \
  -H "Origin: https://yourdomain.com"
```

**Expected Response:**

- Status: `200 OK`
- Headers include: `Access-Control-Allow-Origin`
- Body contains the image data

**Common Errors:**

- `400 Bad Request` - Missing `url` parameter
- `403 Forbidden` - Domain not in whitelist
- `502 Bad Gateway` - Target URL unreachable

### 6. Configure Environment Variables

#### Local Development (`.env.local`)

Development automatically uses public proxy - **no configuration needed**.

#### Production (Vercel Dashboard)

1. Go to your Vercel project
2. Navigate to **Settings → Environment Variables**
3. Add new variable:
   - **Name:** `PUBLIC_SNAPDOM_PROXY_URL`
   - **Value:** `https://img-proxy.yourdomain.com/?url=`
   - **Environment:** Production, Preview
4. Click **Save**
5. Redeploy your application

**Important:** The URL must end with `?url=` - snapDOM will append the target URL to this.

## Environment Configuration

### Development

```env
# .env.local - NO CONFIGURATION NEEDED
# Development automatically uses: https://corsproxy.io/?
```

### Production

```env
# Vercel Environment Variables
PUBLIC_SNAPDOM_PROXY_URL=https://img-proxy.yourdomain.com/?url=
```

### Configuration Behavior

| Environment | Proxy Used                        | Configuration Required |
| ----------- | --------------------------------- | ---------------------- |
| Development | `https://corsproxy.io/?`          | None (automatic)       |
| Production  | Your Cloudflare Worker (optional) | Set env var            |
| Production  | No proxy (if not configured)      | None                   |

## Testing

### 1. Test Locally

```bash
# Start dev server
bun run dev

# Open customer support widget
# Try taking a screenshot
# Check browser console for proxy usage
```

**Expected Logs:**

```
[snapDOM] Using proxy for: https://html.tailus.io/...
```

### 2. Test Production Proxy

```bash
# Test with curl
curl "https://img-proxy.yourdomain.com/?url=https://html.tailus.io/blocks/customers/column.svg"
```

### 3. Test in Browser

1. Open browser DevTools → Network tab
2. Take a screenshot in your app
3. Look for requests to `img-proxy.yourdomain.com`
4. Verify they return `200 OK` with image data

### 4. Test CORS Headers

```bash
curl -I "https://img-proxy.yourdomain.com/?url=https://html.tailus.io/blocks/customers/column.svg" \
  -H "Origin: https://yourdomain.com"
```

**Expected Headers:**

```
HTTP/2 200
access-control-allow-origin: https://yourdomain.com
cache-control: public, max-age=86400
content-type: image/svg+xml
```

## Cost Estimates

### Cloudflare Workers Pricing

**Free Tier:**

- 100,000 requests/day
- Unlimited requests on cached resources
- No time limits
- **Cost: $0/month**

**Paid Tier (if needed):**

- $5/month for 10 million requests
- $0.50 per additional million

### Realistic Usage Examples

**Scenario 1: Small SaaS (100 screenshots/day)**

- Assumptions: 30 external images per screenshot, 24hr cache
- Uncached requests: ~3,000/day
- Cached requests: ~97,000/day (free)
- **Monthly Cost: $0** (well within free tier)

**Scenario 2: Medium SaaS (1,000 screenshots/day)**

- Uncached requests: ~30,000/day
- Still within free tier
- **Monthly Cost: $0**

**Scenario 3: Large SaaS (10,000 screenshots/day)**

- Uncached requests: ~300,000/day
- Total: ~9M requests/month
- Exceeds free tier (3M/month)
- **Monthly Cost: $5-10**

### Cost Optimization Tips

1. **Enable Caching** - Already configured (24hr default)
2. **Whitelist Minimal Domains** - Reduces abuse
3. **Monitor Analytics** - Catch unusual usage early
4. **Consider Same-Origin** - Host critical images yourself

## Troubleshooting

### Issue: "Domain not allowed" Error

**Cause:** Target domain not in `ALLOWED_DOMAINS`

**Solution:**

1. Edit worker code
2. Add domain to `ALLOWED_DOMAINS` array
3. Redeploy worker

### Issue: CORS Error in Browser

**Cause:** Origin not in `ALLOWED_ORIGINS` or CORS headers missing

**Solution:**

1. Check worker logs in Cloudflare dashboard
2. Verify `ALLOWED_ORIGINS` includes your domain
3. Test with curl to see actual headers

### Issue: Images Not Loading

**Possible Causes:**

1. **Proxy URL misconfigured** - Check env var ends with `?url=`
2. **Worker not deployed** - Verify in Cloudflare dashboard
3. **Domain SSL issues** - Ensure custom domain has valid SSL
4. **Target URL invalid** - Check image URL is accessible

**Debug Steps:**

```javascript
// Add to worker for debugging
console.log('Target URL:', targetUrl);
console.log('Origin:', request.headers.get('Origin'));
```

View logs: Cloudflare Dashboard → Workers → Your Worker → Logs

### Issue: High Costs

**Symptoms:** Unexpected Cloudflare charges

**Causes:**

- Proxy being abused by external sites
- Missing domain/origin restrictions
- No caching enabled

**Solutions:**

1. Add strict `ALLOWED_ORIGINS` (remove `'*'`)
2. Enable rate limiting (Cloudflare dashboard)
3. Monitor analytics for abuse patterns
4. Add file size limits (already set to 10MB)

### Issue: Slow Screenshot Capture

**Causes:**

- Large images taking time to proxy
- No caching (first request always slower)
- Network latency to target domain

**Solutions:**

1. Preload images with `preCache()` - already implemented
2. Reduce image sizes at source
3. Use CDN for external images
4. Increase cache duration if appropriate

## Advanced Configuration

### Custom Cache Duration

Edit worker code:

```javascript
// Default: 24 hours (86400 seconds)
const CACHE_DURATION = 86400;

// Or customize per domain:
function getCacheDuration(hostname) {
	if (hostname === 'images.unsplash.com') return 604800; // 7 days
	if (hostname === 'html.tailus.io') return 2592000; // 30 days
	return 86400; // Default 24 hours
}
```

### Custom File Size Limits

```javascript
// Default: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Increase for high-res images:
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
```

### Rate Limiting

Add to Cloudflare Dashboard:

1. Go to **Security** → **WAF** → **Rate Limiting Rules**
2. Create rule: "Block if > 100 requests/minute from same IP"
3. Apply to your worker route

### Analytics

View usage in Cloudflare Dashboard:

1. Go to **Analytics & Logs**
2. Select your worker
3. View:
   - Requests per day
   - Error rates
   - Cache hit ratio
   - Top origins

## Production Checklist

Before deploying to production:

- [ ] Update `ALLOWED_DOMAINS` with actual external domains
- [ ] Update `ALLOWED_ORIGINS` with production domain only
- [ ] Remove localhost entries from `ALLOWED_ORIGINS`
- [ ] Add custom domain to worker
- [ ] Set `PUBLIC_SNAPDOM_PROXY_URL` in Vercel
- [ ] Test proxy with curl
- [ ] Test screenshot capture in production
- [ ] Monitor Cloudflare analytics for first week
- [ ] Set up alerts for high usage (optional)

## Additional Resources

- **Cloudflare Workers Docs:** https://developers.cloudflare.com/workers/
- **SnapDOM Documentation:** https://github.com/zumerlab/snapdom
- **CORS Explained:** https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
- **Project PostHog Proxy:** `docs/analytics/posthog-proxy-setup.md` (similar pattern)

## Support

If you encounter issues not covered here:

1. Check Cloudflare Worker logs
2. Test proxy with curl (see Testing section)
3. Review browser console for snapDOM errors
4. Verify environment variables are set correctly
