---
type: topic
title: "Caching strategies"
description: "An overview of where to place a cache, how to fill it, and how to keep it correct."
tags: [caching, overview]
status: stable
generated: { by: wiki-agent/0.9, at: 2026-09-10T14:00:00+09:00 }
related: [concepts/cache-invalidation, concepts/write-through-cache, concepts/cache-stampede]
---

# Caching strategies

Start from the read pattern. Hot keys with tolerant readers suit a TTL; data that must
be fresh after a write suits a [write-through cache](../concepts/write-through-cache.md);
everything in between needs a deliberate [invalidation](../concepts/cache-invalidation.md)
policy.
