# Caching & ISR-Like Strategy

## Context

- **Stack**: SvelteKit + Convex backend, deployed on Hetzner/RWTH eduroam network
- **Target users**: Students and staff at RWTH Aachen, accessing via campus network
- **Goal**: Serve pages like the team page as cached/static HTML, refreshed periodically

## Why Not Vercel ISR

SvelteKit has no native ISR. The `isr` config only exists in `adapter-vercel`. The core team views ISR as a platform concern ([sveltejs/kit#661](https://github.com/sveltejs/kit/issues/661)).

Standard HTTP caching with `stale-while-revalidate` achieves the same result without vendor lock-in.

## Why NGINX Over a CDN

Users and server are on the same campus network. A CDN (Cloudflare) would add latency by routing traffic off-network and back. NGINX caching on the same box means sub-millisecond cache hits for local users.

## Architecture

```
Admin panel → Convex mutation (upload images, names, etc.)
                        ↓
Page request → NGINX checks cache
                 ├─ HIT  → serve cached HTML instantly
                 └─ MISS → proxy to SvelteKit node server
                              ↓
                           SvelteKit SSR fetches from Convex → renders HTML
                              ↓
                           NGINX caches response, serves to user
```

## SvelteKit Implementation

### Server load function with cache headers

```typescript
// src/routes/[[lang]]/team/+page.server.ts
export const load = async ({ locals, setHeaders }) => {
	const members = await locals.convex.query(api.team.list);

	setHeaders({
		'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200'
	});

	return { members };
};
```

- `s-maxage=3600` — NGINX caches for 1 hour
- `stale-while-revalidate=7200` — after 1h, serve stale while fetching fresh in background (up to 2 more hours)

### Page component (no reactive query needed)

```svelte
<script lang="ts">
	let { data } = $props();
</script>

{#each data.members as member}
	<img src={member.imageUrl} alt={member.name} />
	<p>{member.name}</p>
{/each}
```

No `useQuery`, no WebSocket connection. Pure SSR HTML from cache.

## NGINX Configuration

```nginx
proxy_cache_path /var/cache/nginx/sveltekit levels=1:2 keys_zone=sveltekit:10m
                 max_size=1g inactive=60m use_temp_path=off;

server {
    listen 80;
    server_name your-domain.rwth-aachen.de;

    location / {
        proxy_pass http://localhost:3000;

        # Caching
        proxy_cache sveltekit;
        proxy_cache_valid 200 3600s;            # Cache 200 responses for 1 hour
        proxy_cache_use_stale updating;          # Serve stale while refreshing
        proxy_cache_background_update on;        # Refresh in background (non-blocking)
        proxy_cache_revalidate on;

        # Cache key: method + scheme + host + URI
        proxy_cache_key "$request_method$scheme$host$request_uri";

        # Pass useful headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Debug: add header to see if response was cached
        add_header X-Cache-Status $upstream_cache_status;
    }
}
```

### Key directives

| Directive                          | Purpose                                           |
| ---------------------------------- | ------------------------------------------------- |
| `proxy_cache_valid 200 3600s`      | Cache successful responses for 1 hour             |
| `proxy_cache_use_stale updating`   | Serve stale content while origin regenerates      |
| `proxy_cache_background_update on` | Trigger regeneration without blocking the request |
| `proxy_cache_revalidate on`        | Use conditional requests (If-Modified-Since)      |

### Verify caching is working

```bash
# Check the X-Cache-Status header
curl -I https://your-domain.rwth-aachen.de/team

# Expected values:
# MISS    - First request, fetched from origin
# HIT     - Served from cache
# STALE   - Served stale while refreshing in background
# UPDATING - Background refresh in progress
```

## Applicability

This pattern works for any page with infrequent updates:

- **Team page** — updated by admin, cached 1 hour
- **Pricing page** — rarely changes, cached 24 hours (`s-maxage=86400`)
- **Blog/docs** — cached 1 hour, `stale-while-revalidate` for smooth transitions
- **Landing page** — cached 15 min (`s-maxage=900`) for near-static performance

Pages that need real-time data (dashboards, chat) should skip caching and use Convex's reactive `useQuery` as normal.

## Cost & Performance Benefits

- Convex queries reduced from 1/visitor to ~1/hour per cached page
- Response time for cached pages: sub-millisecond on campus network
- Zero additional infrastructure — NGINX is already the reverse proxy

## Future Considerations

- **On-demand invalidation**: Purge NGINX cache via `proxy_cache_purge` module when admin saves changes (instead of waiting for TTL expiry)
- **Per-route cache policies**: Different TTLs per route via NGINX `location` blocks or SvelteKit `Cache-Control` headers
- **If moving off-campus**: Add Cloudflare in front for global users — the `Cache-Control` headers work with any caching layer
