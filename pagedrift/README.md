# pagedrift

Finds Confluence pages whose code-level claims the current code contradicts: a
class that no longer exists, or a config key the code no longer reads.

This is **kill test 1** for a product idea: a Confluence app that flags pages
contradicted by the code they describe. Existing Confluence freshness apps (FreshPage
and others) track dates and human sign-off. None of them checks whether a page is
actually wrong. This test measures whether that gap is real (**prevalence**) and
whether a deterministic checker can flag it reliably (**precision**).

The rules, thresholds, sample size, and seed are fixed in
[`PREREGISTRATION.md`](PREREGISTRATION.md). That file was committed before the
checker ran on any Confluence data.

## Run

```bash
python -m pagedrift select      # §2.1: choose spaces from page metadata only
python -m pagedrift scan        # extract claims, check them against each repo
python -m pagedrift sample      # §5: fixed-seed sample of 50 flags -> worksheet
python -m pagedrift evidence    # add repository search evidence to each row
# classify every worksheet row by hand: REAL, or FALSE_POSITIVE with a §5 reason
python -m pagedrift verdict     # §6: precision, prevalence, KILLED or PASSED
```

It uses the Python standard library only, needs network access to
`cwiki.apache.org` and `github.com`, and caches pages and clones under `.cache/`.

## How it checks

| Claim | Extracted | Contradicted when |
| --- | --- | --- |
| Class | A fully qualified name in the project's namespace | No type with that name is declared in the repository (**moved** if the simple name exists elsewhere, **missing** if it exists nowhere) |
| Config key | A key under the project's config prefixes, with at least two segments after the prefix | The exact key appears in no non-documentation source file |

Everything is deterministic: regular expressions and index lookups, no LLM. The
extractor favors precision over recall, so it skips camelCase keys, URLs, e-mail
addresses, file names, and package references rather than guess.

## Status

The scanner is built and tested (48 tests). The repository half was checked against
real ZooKeeper code. The Confluence half is waiting on network access to
`cwiki.apache.org`, which this environment's network policy currently blocks.
