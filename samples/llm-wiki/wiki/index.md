---
okf_version: "0.2"
---

# Caching knowledge base

An LLM-maintained wiki in the [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format):
an agent reads sources, writes the pages, and keeps this index and the [log](log.md) up to date.

## Topics

- [Caching strategies](topics/caching-strategies.md) — when to cache, where, and how to keep it correct

## Concepts

- [Cache invalidation](concepts/cache-invalidation.md) — keeping cached data consistent with its source
- [Write-through cache](concepts/write-through-cache.md) — writes go to the cache and the store together
- [Cache stampede](concepts/cache-stampede.md) — many misses for the same key at once

## Sources

- [Notes on a production cache migration](sources/cache-migration-notes.md)
- [Survey of consistency models](sources/consistency-survey.md)
