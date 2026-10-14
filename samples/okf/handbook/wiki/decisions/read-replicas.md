---
type: decision
title: "Add read replicas for reporting (as of 2026-08-07)"
description: "Route reporting queries to two read replicas so they no longer compete with writes."
origin: mixed
tags: [database, scaling]
status: draft
phase: proposed
resolves: [incidents/db-outage]
resource: read-replicas-benchmark.md
see_also: notes/dup.md
diagram: attachments/diagram.pdf
missing_ref: incidents/does-not-exist
generated: { by: my-agent/2.0, at: 2026-08-07T10:00:00+09:00 }
verified: { by: "human:alice", at: 2026-08-08T09:00:00+09:00 }
sources:
  - { id: bench1, resource: read-replicas-benchmark.md, title: "Replica benchmark notes", relation: arising-from, last_modified: 2026-08-09T00:00:00Z }
  - { id: lee2023, resource: attachments/diagram.pdf, title: "Replication topology", relation: inspired-by }
root: handbook
---

# Add read replicas for reporting

Replicas lag by well under a second, which reporting tolerates[^lee2023].
The benchmark is written up separately[^bench1]. A citation with no source is marked[^nosuch].

An ordinary footnote defined in the body still works[^note].

[^note]: This footnote is defined in the body.
