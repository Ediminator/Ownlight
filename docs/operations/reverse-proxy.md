# Reverse Proxy Architecture & Client IP Resolution

This document details the reverse proxy requirements, client IP resolution semantics, and configuration for Ownlight deployments.

---

## 1. Overview & Operational Requirements

Ownlight is designed to run behind a trusted reverse proxy in production deployments. A reverse proxy (such as Caddy, Nginx, Traefik, or HAProxy) provides essential network and transport capabilities:

- Automatic TLS termination and HTTPS redirection.
- HTTP/2 and HTTP/3 transport negotiation.
- Static asset caching and buffering.
- Connection throttling and edge firewall protections.

For self-hosting, the reference deployment places **Caddy** directly in front of the Next.js application container.

---

## 2. Threat Model: Client IP Spoofing (F1 Mitigation)

Client IP addresses are critical for anti-automation and brute-force defenses (e.g. rate limiting failed sign-ins, password reset requests, and MFA attempts).

Prior to TASK-0023, application code inspected `X-Real-IP` or the _first_ (left-most) entry of `X-Forwarded-For`. Both sources are untrusted and attacker-controlled:

- An attacker can inject arbitrary headers (`X-Real-IP: <random_ip>` or `X-Forwarded-For: <random_ip>, ...`) on every HTTP request.
- When an attacker sends a spoofed `X-Forwarded-For: 1.2.3.4`, an upstream reverse proxy appends the genuine socket peer IP to the end of the list: `X-Forwarded-For: 1.2.3.4, 203.0.113.9`.
- Trusting the left-most entry evaluates the attacker's fake IP (`1.2.3.4`), completely bypassing per-IP rate limits.
- Trusting `X-Real-IP` allows the attacker to pass any string or bypass proxy sanitation entirely.

### Mandatory Rules (TASK-0023)

1. **Never read `X-Real-IP`:** Application code never inspects `X-Real-IP`.
2. **Right-most N-th hop from `X-Forwarded-For`:** Only the N-th IP from the right (`L[len - N]`) is trusted, where `N = TRUSTED_PROXY_COUNT`.
3. **Fail-safe mapping to `'unknown'`:** When `TRUSTED_PROXY_COUNT = 0`, or the header is missing, or has fewer than N entries, or the selected entry is syntactically invalid, the resolver returns `null`, which callers map to a shared `'unknown'` bucket (stricter, not looser).

---

## 3. Next.js 16 Socket Peer Behavior Finding

During TASK-0023 analysis, `next start` (Next.js 16.4.0 Node.js server runtime) was verified regarding its handling of client IP headers:

- Next.js standard Node.js server does **not** append its own TCP socket peer to incoming `X-Forwarded-For` headers.
- Application code (server actions, route handlers, middleware) receives `X-Forwarded-For` exactly as assembled and forwarded by the upstream reverse proxies.

**Conclusion for Reference Deployment:**
In the reference deployment (Internet -> Caddy -> Next.js), exactly **1** reverse proxy hop appends the client IP to `X-Forwarded-For`. Therefore, the reference deployment configuration is:

```env
TRUSTED_PROXY_COUNT=1
```

---

## 4. Configuration Matrix (`TRUSTED_PROXY_COUNT`)

The `TRUSTED_PROXY_COUNT` environment variable controls how many proxy hops the resolver counts from the right of `X-Forwarded-For` (allowed range: `0` to `5`, default `1`):

| Topology                                               | `TRUSTED_PROXY_COUNT` | Resolution Logic                    | Example Header & Resolved IP                                       |
| :----------------------------------------------------- | :-------------------: | :---------------------------------- | :----------------------------------------------------------------- |
| **Reference (Caddy -> Next.js)**                       |          `1`          | 1st entry from right (`L[len - 1]`) | Header: `spoofed.ip, 203.0.113.9` &rarr; `203.0.113.9`             |
| **CDN + Caddy (Cloudflare / AWS -> Caddy -> Next.js)** |          `2`          | 2nd entry from right (`L[len - 2]`) | Header: `spoofed.ip, 203.0.113.9, 172.68.1.1` &rarr; `203.0.113.9` |
| **Direct Socket / Testing (No proxy)**                 |          `0`          | Returns `null` (bucket: `unknown`)  | Any header &rarr; `unknown` (stricter anti-abuse bucket)           |

---

## 5. Reference Caddy Configuration

Below is the reference Caddyfile snippet forwarding requests to Ownlight:

```caddyfile
crm.example.com {
    encode gzip zstd

    # Security headers
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    # Reverse proxy to Next.js application container
    # Caddy automatically appends incoming client remote IP to X-Forwarded-For
    reverse_proxy ownlight-app:3000 {
        header_up Host {host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```
