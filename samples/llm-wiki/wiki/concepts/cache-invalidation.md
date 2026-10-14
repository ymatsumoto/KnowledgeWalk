---
type: concept
title: "Cache invalidation"
description: "Removing or refreshing cached entries when the data behind them changes, so readers never act on stale values for longer than the system can tolerate."
tags: [caching, consistency]
aliases: [cache busting, purge]
status: stable
generated: { by: wiki-agent/0.9, at: 2026-09-12T08:30:00+09:00 }
verified: { by: "human:alice", at: 2026-09-13T10:00:00+09:00 }
related: [concepts/write-through-cache, concepts/cache-stampede, topics/caching-strategies]
sources:
  - { id: migration, resource: ../sources/cache-migration-notes.md, title: "Notes on a production cache migration" }
  - { id: survey, resource: ../sources/consistency-survey.md, title: "Survey of consistency models" }
---

# Cache invalidation

Every cache trades freshness for speed. Invalidation decides how much freshness is given
up: an entry can expire after a fixed time, be evicted when the source changes, or be
replaced on the next write[^survey].

## Approaches

- **Time to live.** Simple and robust, but every entry is stale for up to its TTL.
- **Event-driven purge.** The writer publishes a change and caches drop the key. Fresher,
  but a lost event leaves an entry stale until it expires.
- **Write-through.** See [Write-through cache](write-through-cache.md): the cache is
  updated as part of the write, so reads after a write see it.

In the migration we studied, combining a short TTL with event-driven purges removed the
long tail of stale reads that either approach left on its own[^migration].

## Pitfalls

Purging a popular key makes every reader miss at once — a
[cache stampede](cache-stampede.md).
