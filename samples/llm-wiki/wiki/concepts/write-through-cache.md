---
type: concept
title: "Write-through cache"
description: "A cache that is written in the same operation as the backing store, so a read after a write is served fresh from the cache."
tags: [caching, writes]
status: stable
generated: { by: wiki-agent/0.9, at: 2026-09-10T15:00:00+09:00 }
verified: { by: process:link-check, at: 2026-09-10T16:00:00+09:00 }
related: [concepts/cache-invalidation]
sources:
  - { id: survey, resource: ../sources/consistency-survey.md, title: "Survey of consistency models" }
---

# Write-through cache

Writes update the cache and the store together; reads are served from the cache. Write
latency rises, but a value read after a write is never older than that write[^survey].

Compare [cache invalidation](cache-invalidation.md), which deals with the writes a
write-through cache does not see.
