---
type: source
title: "Notes on a production cache migration"
description: "Internal notes from moving a read-heavy service to a shared cache, with stale-read measurements."
resource: https://example.com/notes/cache-migration
tags: [caching, case-study]
status: stable
generated: { by: wiki-agent/0.9, at: 2026-09-10T11:00:00+09:00 }
---

# Notes on a production cache migration

Summary of the measurements and the TTL/purge combination that was finally deployed.
