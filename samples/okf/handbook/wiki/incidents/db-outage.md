---
type: incident
title: "Primary database outage"
description: "Write traffic saturated the primary for 40 minutes; read replicas would have absorbed the reporting load."
origin: postmortem
tags: [database, availability, postmortem]
priority: high
status: stable
impact: major
resolved_by: [decisions/read-replicas]
related_incidents: []
created: 2026-08-07
generated: { by: my-agent/1.4, at: 2026-08-07T00:00:00Z }
phase: open
sources:
  - { id: bench1, resource: ../decisions/read-replicas-benchmark.md, title: "Replica benchmark notes", relation: arising-from }
  - { id: smith2024, resource: "https://example.com/papers/smith2024", title: "Scaling read-heavy workloads", relation: key-source }
root: handbook
---

# Primary database outage

> **Warning:** the vendor's guidance and our own load test reach the same conclusion[^smith2024].

Reporting queries alone kept the primary above 90% CPU for the whole incident[^bench1].

Related: [the decision](../decisions/read-replicas.md), [the same decision, root-relative](/decisions/read-replicas.md)
