# Result: kill test 1 is KILLED on precision

| Metric | Result | Preregistered floor | Rule |
| --- | --- | --- | --- |
| Precision | **0.74** (37 of 50 sampled flags are real; 95% CI 0.60–0.84) | 0.80 | **K1a fires** |
| Estimated prevalence | **34%** of claim-bearing pages (36/78 flagged × 0.74) | 5% | K1b passes |
| Fresh but wrong (secondary) | **0** of 37 real flags are on pages edited in the last 365 days | reported, never a kill | — |

Under the rules in [`PREREGISTRATION.md`](PREREGISTRATION.md) §6, the test is **KILLED**.
The miss is narrow: three more real flags would have reached the floor. Section 4 shows
which judgment calls the verdict rests on. The checker was not the main problem. Two
other findings matter more for the product than the precision miss (section 7).

## 1. What ran

Everything ran on 2026-09-28, in this order, with each step's output committed.

1. **Selection** (§2.1, page metadata only). Seven of the 12 candidates qualified. The
   rule picked OFBiz, CloudStack, Kafka and Tika (`results/selection.json`, committed
   before any page body was read).
2. **Scan** (`results/findings.jsonl`, `results/summary.json`). Scan time
   16:21 UTC. Repositories were shallow clones of each default branch.
3. **Sample** (§5). Seed 20260928 drew 50 of the 65 flags (`results/worksheet.csv`).
4. **Verification.** Every sampled flag was read in its page and searched for in the
   repository. The `verdict`, `reason` and `note` columns of the worksheet record each call and its evidence.
5. **Verdict** (`results/verdict.json`).

| Project | Repo commit | Pages | After §3 filter | Claim-bearing | Flagged pages | Flags | Sampled | Real |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OFBiz | `acaefd6013d8` | 704 | 496 | 14 | 1 | 1 | 1 | 0 |
| CloudStack | `0a5bf30af32b` | 1,253 | 502 | 17 | 5 | 10 | 9 | 5 |
| Kafka | `80b559a0f1df` | 1,661 | 137 | 4 | 2 | 2 | 1 | 1 |
| Tika | `df85810303bd` | 112 | 107 | 43 | 28 | 52 | 39 | 31 |
| **Total** | | **3,730** | **1,242** | **78** | **36** | **65** | **50** | **37** |

None of the four selected projects has config prefixes in `candidates.json`, so every
claim checked was a class name.

## 2. What a real flag looks like

- Tika's `TikaServer` page tells users to call
  `/translate/all/org.apache.tika.language.translate.MicrosoftTranslator/es/en`. The
  translators moved to `...translate.impl` in 2.0, so that call fails today.
- Tika's `TikaAndVision` pages configure `ObjectRecognitionParser` with the Tensorflow
  recognisers. Tika 4.0.0 removed them with no replacement.
- CloudStack's *Development 101* pages still describe `components.xml` and
  `DefaultComponentLibrary`, which the 2013 move to Spring replaced.

## 3. Where the 13 false positives came from

| Cause | Flags | Rows |
| --- | ---: | --- |
| Page is not current documentation but passed the §3 title filter: a design discussion whose CamelCase title (`CompositeParserDiscussion`) hides the word, and a Google Summer of Code student report under *Student Projects* | 5 | 16, 26, 31, 38, 43 |
| The class name appears only inside pasted log or expected output | 3 | 2, 7, 36 |
| A tutorial asks the reader to write the class | 2 | 13, 24 |
| Materials for dated past events (2021 workshops) | 1 | 41 |
| Page explicitly scoped to an older release ("In Tika 2.x, …") | 1 | 47 |
| Not a class at all: an OFBiz entity `package-name` attribute | 1 | 9 |

Only one false positive is the extractor misreading text. The rest are judgments about
what a page is (a proposal, a report, a tutorial, an event) or which parts of it are
instructions and which are captured output.

## 4. Judgment calls and how they move the verdict

§5 does not cover every case, so four interpretations were needed. Each one was decided
in the direction that works against passing, because the builder of the checker is also
its verifier (§5, "Known bias").

| Judgment | Rows | Call made | Precision if reversed |
| --- | --- | --- | --- |
| A class named only inside pasted output is not "presented as current", unless the page is about that class | 2, 7, 36 | False positive | 40/50 = **0.80**, which would pass K1a |
| "In Tika 2.x, users may …" is explicit version scoping | 47 | False positive (`page_versioned`) | 38/50 = 0.76 |
| Proposal-type pages that slipped past the §3 filter are not current documentation | 16, 26, 31, 38, 43 | False positive | 42/50 = 0.84 |
| A page about a parser counts as presenting it, even where its class name appears only in output | 19 | Real | 36/50 = 0.72 |

Jar names in commands (for example `tika-app-1.15-SNAPSHOT.jar`) were not treated as
version scoping. A page counts as versioned only if it says so in words.

The verdict therefore turns on the first row. The confidence interval (0.60–0.84)
contains the floor. The preregistered rule applies to the point estimate, and the point
estimate is below the floor.

## 5. Where the real contradictions came from (exploratory)

This analysis was not preregistered. For each real Tika flag, the class name was
compared with the file list of Tika's last release before 4.0: tag `3.3.0`, commit
`cd800dd8d37a`.

| Cause | Real flags |
| --- | ---: |
| Tika 4.0.0, released 2026-08-18 (six weeks before the scan), removed or renamed the class | 17 |
| The class was already absent from Tika 3.3.0: 2.0 package moves (`TikaServerCli`, the translators, `TikaEvalCLI`), `HtmlParser` replaced by `JSoupParser` in 3.0, and two names that did not match 3.3.0 either (`MSGraphFetcher`, and `ExampleNNModelDetector`, which the page got wrong from the start) | 14 |
| CloudStack developer pages from 2012–2013 describing code since refactored away (the Spring migration and later changes) | 5 |
| Kafka Streams test class removed in 3.0 (2021) | 1 |

Tika accounts for 31 of the 37 real flags, and one Tika release accounts for 17 of them.

## 6. Prevalence passes easily

46% of claim-bearing pages have at least one flag. Discounted by precision, an
estimated 34% have a real contradiction, far above the 5% floor. The pain the idea
assumes does exist on pages that name code.

## 7. What this means for the product

These points are not kill rules, but they weigh against the idea more than the precision miss does.

- **The checker is silent on almost every page.** Only 78 of 1,242 filtered pages
  (6%) name a class in their project's namespace. With config keys out of scope for
  these projects, the product would have nothing to say about 94% of the wiki.
- **Recently edited pages were not wrong.** 66 filtered pages were edited in the year
  before the scan. Nine of them name code, and none of those nine was flagged. The
  newest page with a flag was last edited 1.5 years before the scan, and the median
  flagged page is 6.6 years old. Every real contradiction sits on a page last edited
  more than two years before the scan. A date-based staleness badge such as FreshPage
  would already mark all of them as old. The differentiation claim ("we catch what
  freshness dates miss") got no support.
- **Apache is a harsh proxy** (§7). Tika now keeps its documentation in the repository
  (`docs/`), so its wiki pages get little maintenance. A company wiki under active use
  may look different. This test cannot say how.

## 8. What reviving it would take

§8's outcome text allows a redesign "before any product work". If the idea is revived,
it needs a new preregistered test, not a re-scoring of this sample. That test would
need to:

1. Fix the filter misses: split CamelCase titles, and exclude *Student Projects* and
   event pages.
2. Skip names that appear only inside log or output blocks.
3. Run on spaces this test did not scan. Ignite, CXF and Solr qualified under §2.1 but
   were not selected, and their page bodies have not been read.

Even if precision cleared the floor there, the coverage and freshness findings in section 7 would remain.

## Files

| File | Contents |
| --- | --- |
| `results/selection.json` | §2.1 statistics for all 12 candidates and the selection |
| `results/findings.jsonl` | Every checked claim with its status |
| `results/summary.json` | Per-space counts, repository commits, scan time |
| `results/worksheet.csv` | The 50 sampled flags with evidence, verdict, reason and notes |
| `results/verdict.json` | Output of `python -m pagedrift verdict` |
