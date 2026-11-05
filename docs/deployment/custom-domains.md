# Custom domains

Serve the app from your own domain on Cloudflare Workers, with the domain's DNS on Cloudflare or elsewhere.

## Custom domain (Cloudflare Workers)

If your domain's DNS is on Cloudflare: CF dashboard > Workers & Pages > select Worker > Settings > Domains & Routes > Add > Custom Domain. CF creates DNS records and provisions SSL automatically. Set `SITE_URL` on your Convex production deployment to match.

Once a custom domain is live, marketing pages are edge-cached (`s-maxage`). Configure the [edge cache purge](cloudflare.md#edge-cache-purge) so production deploys do not serve stale HTML.

If your domain uses external DNS, use the CF for SaaS method below.

## Custom domain without Cloudflare DNS (CF for SaaS)

CF Workers custom domains require the domain's DNS zone to be on Cloudflare. If your domain uses external DNS (e.g., registrar-managed DNS, Route 53), use [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/) (Custom Hostnames) on a CF-managed zone you control.

**Prerequisites:**

- A Cloudflare-managed zone (e.g., `proxy-zone.com` with DNS on CF)
- Your external domain (e.g., `app.yourdomain.com` on non-CF DNS)

**Steps:**

1. In your CF zone's DNS, add an originless record for the fallback origin:
   - Type: `AAAA`, Name: `saas-fallback`, Value: `100::`, Proxy: enabled

2. In **SSL/TLS > Custom Hostnames**, set the fallback origin to `saas-fallback.proxy-zone.com`

3. Add a wildcard Workers Route on the zone: `*/*` pointing to your Worker

4. Add `app.yourdomain.com` as a Custom Hostname (certificate auto-provisions via HTTP validation)

5. On your external DNS, add a CNAME: `app.yourdomain.com` pointing to `saas-fallback.proxy-zone.com`

6. For automatic cert renewal, add a DCV delegation CNAME on your external DNS:
   `_acme-challenge.app.yourdomain.com` pointing to `<token>.dcv.cloudflare.com` (shown in the Custom Hostnames dashboard)

7. Set `SITE_URL` on your Convex production deployment to `https://app.yourdomain.com`

The originless `100::` record tells Cloudflare there is no real origin server. The wildcard Workers Route catches all traffic entering the zone (including Custom Hostname traffic) and routes it to your Worker.

## Cache headers (Cloudflare)

No zone cache tuning is needed. HTML shells ship `Cache-Control: public, no-cache`, so a returning visitor always revalidates and never boots a stale shell that points at chunk hashes a new deploy has replaced (which would render a blank page until a hard refresh). Because `no-cache` also keeps the shell out of the edge cache, the zone's Browser Cache TTL setting (which rewrites the browser-facing `max-age` of edge-cacheable responses up to its floor, 4 hours by default) never applies to it.

After deploying, verify the live header carries no injected `max-age`:

```bash
curl -sI https://your-domain.example/en | grep -i cache-control
# expect: public, no-cache
```
