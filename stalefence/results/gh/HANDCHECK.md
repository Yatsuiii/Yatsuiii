# Hand-check (PREREGISTRATION.md §2.4)

20 sessions drawn with seed 20260930 and read against their raw shard events
(`pipeline/handcheck.py`). Each session's linked-PR, exposure (E_in at 1 h) and outcome were
compared to the events. **0 of 20 were misclassified** (the bar to rerun is >2), so the
pipeline is used as is.

## What the check surfaced about the no-PR and ambiguous categories

- **no linked PR: 486 / 753 (65%).** Diagnosed on a 40-session sample: 27 (68%) had **no**
  Copilot-opened PR at any time after `t0`; 13 (32%) had a Copilot PR opened **later than
  30 min** after `t0` (queued/delayed work, correctly excluded from prompt sessions); 0 had a
  PR inside 30 min that the linker missed. So the no-PR rate is genuine, not a linking bug:
  most public issue-assignments to Copilot do not yield a prompt PR, and some are even closed
  by the human within minutes (e.g. `OlliV/lens-ring#8`, closed 9 min after assignment).
- **ambiguous: 103 / 753 (14%).** Repos running several Copilot sessions at once
  (`Quirk-Systems/quirk-os`, `github/gh-aw`, …), where a Copilot PR cannot be attributed to
  one of the overlapping sessions. Excluded by design.

This leaves **164 linked sessions**, **34** of them in team repos (the primary population).
