# API reference

This skill talks to two separate, unrelated public APIs. Both are keyless, but both ask for a descriptive `User-Agent` (see `scripts/user-agent.ts`; set `WIKI_UA_CONTACT` once per environment).

## 1. Wikimedia Analytics API (AQS) - the pageview data

Base: `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/{project}/{access}/{agent}/{article}/{granularity}/{start}/{end}`

Implemented in `scripts/wikimedia-client.ts`.

| Segment | Values | Notes |
|---|---|---|
| `project` | e.g. `en.wikipedia`, `pl.wikipedia`, `cs.wikipedia`, `uk.wikipedia`, `commons.wikimedia` | Domain-style project code, no `.org`. |
| `access` | `all-access`, `desktop`, `mobile-app`, `mobile-web` | `all-access` sums the others. |
| `agent` | `all-agents`, `user`, `spider`, `automated` | **Default to `user`.** `all-agents` includes bot/crawler traffic, which does not reflect reader interest and can dominate the numbers for lightly-trafficked articles. |
| `article` | exact title, spaces or underscores accepted | The client underscore-normalizes and URI-encodes this; get the exact title from `resolve-title` first. |
| `granularity` | `daily`, `monthly` | Use `monthly` for ranges over ~6 months to keep response size and chart legibility sane. |
| `start`, `end` | `YYYYMMDD` | The CLI takes `YYYY-MM-DD` and converts this for you. |

Gotchas:

- **Data starts 2015-07-01.** Earlier `start` dates are rejected client-side (`EARLIEST_AVAILABLE_DATE` in `wikimedia-client.ts`) rather than sent to the API, so the failure is immediate and clear.
- **The most recent 1-2 days may be missing** - this is normal publication lag, not an error.
- **A 404 response means "no data for this article/range"**, not necessarily "the article doesn't exist" - it's also returned for a real article with zero traffic in the window. The client treats this as a legitimate empty series (`[]`), not a thrown error.
- No documented hard rate limit, but requests should be made sequentially, not in a tight parallel burst, and always with a real `User-Agent`.
- There's also an `aggregate` endpoint (whole-project totals) and a `top` endpoint (most-viewed articles) at the same base path with different path shapes - not used by this skill's current commands, but worth knowing about if you extend it (e.g. to normalize an article's views against total project traffic).

## 2. MediaWiki REST API (per-wiki) - resolving a topic to an exact title

Base: `https://{project}.org/w/rest.php/v1/search/page?q={query}&limit={n}`

Implemented in `scripts/resolve.ts`. This is a **different host** per language wiki (e.g. `pl.wikipedia.org`, not `wikimedia.org`) - it's the wiki's own MediaWiki search, unrelated to the AQS pageviews service above.

Response shape:

```json
{
  "pages": [
    { "id": 38930, "key": "Jupiter", "title": "Jupiter", "excerpt": "...", "description": "..." }
  ]
}
```

Use `key` (already underscore-normalized) as the `article` value for the pageviews client - don't use `title` directly, since it may contain spaces or differ subtly in capitalization from the canonical DB key.

## Caching

`wikimedia-client.ts` caches every AQS response on disk under `cache/`, keyed by a hash of every parameter that affects the response (project, article, access, agent, granularity, start, end). Entries expire after 7 days (historical pageview counts for a past period don't change, so this is mostly about not re-hitting the API on every follow-up question in a session). Pass `--refresh` to bypass the cache for one call. `resolve-title` is not cached - it's cheap, and caching a search-by-topic result risks staleness if a wiki's content changes.
