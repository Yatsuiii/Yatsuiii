# Preregistration: do Confluence pages contradict the code they describe?

| Field | Value |
| --- | --- |
| Registered | 2026-09-28, before the checker has run on any Confluence data |
| Status | Frozen at the commit that adds this file. Changes go in §9 with a date and a reason. |
| Decides | Kill test 1 for the product idea "a Confluence app that flags pages contradicted by the code" |

## 1. Question

Take documentation pages in public Apache Confluence spaces. How often do they make
code-level claims (class names, configuration keys) that the project's current code
contradicts? And can a deterministic checker flag those contradictions precisely
enough to sell?

## 2. Data

- **Pages.** From public Apache Confluence spaces on cwiki.apache.org, read through its
  REST API.
- **Code.** A shallow clone of each project's default branch on GitHub. The commit SHA
  is recorded at scan time.
- **Candidates.** Fixed in `candidates.json`: 12 Apache projects, each with its space
  key, repository, and namespaces.

### 2.1 Space selection (mechanical, metadata only)

Space selection uses page metadata only (titles, ancestors, last-edit dates). No page
body is read and no claim is checked during selection.

For each candidate:

1. List every current page in its space and apply the §3 page filter.
2. The candidate qualifies if it has at least **50** filtered pages and at least **10**
   filtered pages edited on or after **2024-09-28**.

From the qualifying candidates, select up to **4**: the ones with the most filtered
pages edited on or after 2024-09-28. Ties are broken alphabetically.

Favoring actively maintained spaces is deliberately conservative. Maintained
documentation should contradict its code less often, so the rule works against the
prevalence test in §6.

## 3. Page filter

A page is excluded if its title, or any ancestor's title, matches either of these:

- an issue or proposal identifier: `\b[A-Z]{2,6}-\d+\b` (KIP-123, FLIP-12, HIVE-4567);
- a non-documentation word (case-insensitive, whole word): proposal(s), design,
  meeting(s), minutes, release plan(s), roadmap(s), board report(s), retrospective(s),
  archive(d), deprecated, historical, release note(s), changelog(s), changes in, how to
  release, gsoc, summer of code, interview(s), status, vote(s), voting, incubat*,
  draft(s), brainstorm*, discussion(s), idea(s).

Proposals, minutes, and release notes describe the future or the past, not the current
system. Checking them against today's code would produce contradictions by design.

## 4. Claims and checks

Claims are extracted from the page's storage-format body, including code macros.
Checks are deterministic string and index lookups; there is no LLM anywhere in the
pipeline.

| Claim | Extracted when | Counts as contradicted when |
| --- | --- | --- |
| **Class** | A fully qualified name, up to its first capitalized segment, that starts with one of the project's `class_prefixes` and none of its `class_exclude_prefixes` | No type with that fully qualified name is declared in the repository. The flag is **moved** if the simple name exists in another package, and **missing** if it exists nowhere. |
| **Config key** | A dotted key starting with one of the project's `config_prefixes`, with at least two further segments, not part of a URL, file name, or package | The exact key does not appear in any non-documentation source file. A key that is only a prefix of existing keys is a **namespace**, and is neither checked nor counted. |

Types are indexed from `package` declarations plus declarations of `class`,
`interface`, `enum`, `record`, `@interface`, `object`, and `trait` in `.java`,
`.scala`, `.kt`, and `.groovy` files. The config-key index excludes documentation
paths (`docs/`, `doc/`, `site/`, `website/`, `xdocs/`, `documentation/`) and prose
files.

**A claim-bearing page** is a filtered page with at least one checked claim.

## 5. Verification

Flags are sampled uniformly at random with seed **20260928**. The sample is **50**
flags, or every flag if there are fewer than 50.

Each sampled flag is checked against the evidence below and classified. The evidence
for every sampled flag is recorded in the committed worksheet.

| Verdict | Criteria |
| --- | --- |
| **REAL** | The page presents the entity as current (instructions, configuration, usage, architecture), and a case-insensitive search of the whole repository, including docs, confirms the entity is absent under that name. |
| **FALSE POSITIVE** | One of: `entity_exists` (an extraction or indexing miss); `other_project` (the entity belongs to another codebase); `dynamic` (the key or class is built at runtime); `page_historical` (the page is explicitly about the past); `page_versioned` (the page explicitly scopes itself to an older release); `extraction_error`; `other` (explained in the worksheet). |

**Known bias:** the builder of the checker does the verification. The worksheet is
committed so the classifications can be audited.

## 6. Metrics and kill rules

- **Precision** is REAL divided by the number of verified flags.
- **Prevalence** is the estimated share of claim-bearing pages with at least one real
  contradiction: (claim-bearing pages with any flag ÷ claim-bearing pages) × precision.
  This assumes precision is roughly uniform across pages, and the report says so.

| Rule | Kill when |
| --- | --- |
| **K1a — precision** | precision < **0.80** |
| **K1b — prevalence** | estimated prevalence < **5%** |

The test is **PASSED** only if neither kill rule fires.

**Secondary metric (reported, never a kill):** "fresh but wrong", the share of REAL
flags on pages edited within 365 days of the scan date. These are contradictions that
a date-based freshness badge would label fresh, so this metric tests the
differentiation claim against date-based apps like FreshPage.

## 7. Limitations known in advance

- **Apache spaces are harsher than company wikis.** Volunteer projects often abandon
  wiki pages when docs move into the repository, so prevalence may overstate what a
  company's Confluence looks like. Precision and fresh-but-wrong transfer better.
- **Version skew.** Pages may document a released version while the default branch
  has moved on. The `page_versioned` verdict handles pages that say so; pages that
  don't count as REAL, because a reader cannot tell either.
- **Two claim types only.** Commands, file paths, endpoints, and environment
  variables are out of scope, so recall is understated by design.

## 8. What each outcome means

| Outcome | Meaning |
| --- | --- |
| **KILLED on precision** | A deterministic checker cannot flag Confluence contradictions reliably enough to sell. Drop the idea, or redesign the claims before any product work. |
| **KILLED on prevalence** | Documentation contradicts code too rarely for the pain to exist at this depth. |
| **PASSED** | Kill test 1 is cleared. Tests 2 (demand) and 3 (platform) remain before building. |

## 9. Deviations (append-only)

| Date | Section | Change | Reason |
| --- | --- | --- | --- |
| 2026-09-28 | §5 | No rule changed. Verification needed four judgments that §5 does not spell out: pasted output, version wording, proposal-type pages the §3 filter missed, and a page about the flagged class. [`RESULTS.md`](RESULTS.md) §4 lists each one and how it moves the verdict. | Keeps the audit trail complete. |
