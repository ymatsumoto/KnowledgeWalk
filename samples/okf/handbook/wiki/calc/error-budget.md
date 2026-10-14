---
type: Attested Computation
title: "Monthly error budget"
description: "Compute the remaining error budget from request and failure counts."
runtime: python
parameters:
  - { name: month, type: string, required: true }
  - { name: slo, type: number, required: false }
executor: { resource: ../decisions/read-replicas-benchmark.md }
attester: { resource: ../decisions/read-replicas-benchmark.md }
generated: { by: my-agent/1.4, at: 2026-08-10T00:00:00Z }
root: handbook
---

# Monthly error budget

# Computation

```python
def error_budget(month, slo=0.999):
    ...
```
