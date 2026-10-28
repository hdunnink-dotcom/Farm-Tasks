---
name: Assistant source provenance
description: Compatibility rule for assistant proposals created before source ownership metadata was captured.
---

When adding provenance to stored assistant source items, return safe source labels for pre-existing proposals that lack the new fields.

**Why:** Older pending suggestions remain useful and should not make the owner approval inbox fail merely because a later version adds mailbox, calendar, or forwarding context.

**How to apply:** Treat source metadata as additive at API read time; new scans should persist the full context, while historic records receive a clearly generic but accurate fallback label.