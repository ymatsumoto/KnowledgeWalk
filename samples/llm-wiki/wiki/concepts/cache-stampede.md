---
type: concept
title: "Cache stampede"
description: "Many concurrent requests miss on the same expired key and all hit the backing store at once."
tags: [caching, availability]
status: draft
generated: { by: wiki-agent/0.9, at: 2026-09-12T09:00:00+09:00 }
related: [concepts/cache-invalidation]
sources:
  - { id: migration, resource: ../sources/cache-migration-notes.md, title: "Notes on a production cache migration" }
---

# Cache stampede

When a popular entry expires, every request for it misses together. Request coalescing
or a short random jitter on expiry spreads the load[^migration].
