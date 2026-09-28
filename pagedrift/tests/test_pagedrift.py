"""Tests for pagedrift. Synthetic fixtures only; no network."""

import csv
import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pagedrift import rules  # noqa: E402
from pagedrift.check import MISSING, MOVED, NAMESPACE, OK, check_claim  # noqa: E402
from pagedrift.cli import main  # noqa: E402
from pagedrift.confluence import Page, iter_space_pages, load_or_fetch  # noqa: E402
from pagedrift.extract import Claim, code_text, extract_claims, storage_to_text  # noqa: E402
from pagedrift.filters import exclusion_reason  # noqa: E402
from pagedrift.repo import build_index  # noqa: E402

HIVE = dict(class_prefixes=["org.apache.hadoop.hive.", "org.apache.hive."],
            config_prefixes=["hive."])


def page(title="Configuration Properties", ancestors=(), body="", when="2025-06-01T00:00:00.000Z"):
    return Page("1", "Hive", title, tuple(ancestors), when, "https://x/p", body)


def values(claims, kind):
    return sorted(c.value for c in claims if c.kind == kind)


class TestFilter:
    """§3: proposals, minutes and release notes never reach the checker."""

    @pytest.mark.parametrize("title", [
        "KIP-500: Replace ZooKeeper", "HIVE-12345 regression", "Design Document",
        "Meeting Minutes 2019", "Hive 0.13 Release Notes", "Roadmap", "Status Report",
        "Draft: new API", "Ideas for GSoC",
    ])
    def test_non_documentation_titles_are_excluded(self, title):
        assert exclusion_reason(page(title=title)) is not None

    def test_ancestors_count(self):
        assert exclusion_reason(page(title="Protocol", ancestors=("Home", "Design Docs")))

    @pytest.mark.parametrize("title", [
        "Configuration Properties", "LanguageManual DDL", "Getting Started", "Admin Guide",
    ])
    def test_documentation_titles_are_kept(self, title):
        assert exclusion_reason(page(title=title)) is None


class TestText:
    STORAGE = (
        "<p>Implement <code>org.apache.hive.Foo</code> &amp; see &lt;property&gt;.</p>"
        '<ac:structured-macro ac:name="code"><ac:plain-text-body>'
        "<![CDATA[set hive.exec.parallel=true;]]></ac:plain-text-body></ac:structured-macro>"
    )

    def test_text_keeps_code_macro_bodies_and_unescapes(self):
        text = storage_to_text(self.STORAGE)
        assert "org.apache.hive.Foo" in text and "set hive.exec.parallel=true;" in text
        assert "& see <property>" in text

    def test_code_text_is_only_code(self):
        code = code_text(self.STORAGE)
        assert "org.apache.hive.Foo" in code and "hive.exec.parallel" in code
        assert "see" not in code


class TestExtract:
    """§4 claim extraction: precision over recall."""

    def test_class_claims_are_scoped_to_the_project(self):
        body = ("<p>org.apache.hadoop.hive.ql.exec.Operator extends "
                "org.apache.hadoop.conf.Configured; see org.apache.hive.service.cli.CLIService"
                "#execute and org.apache.hadoop.hive.conf.HiveConf.ConfVars.</p>")
        claims = extract_claims(body, **HIVE)
        assert values(claims, "class") == [
            "org.apache.hadoop.hive.conf.HiveConf",
            "org.apache.hadoop.hive.ql.exec.Operator",
            "org.apache.hive.service.cli.CLIService",
        ]

    def test_exclude_prefixes_drop_other_projects(self):
        claims = extract_claims("<p>org.apache.hadoop.hive.Foo org.apache.hadoop.fs.Path</p>",
                                ["org.apache.hadoop."], ["org.apache.hadoop.hive."])
        assert values(claims, "class") == ["org.apache.hadoop.fs.Path"]

    def test_config_keys_need_two_segments_after_the_prefix(self):
        body = "<p>Set hive.exec.parallel and hive.metastore.uris, not hive.metastore alone.</p>"
        assert values(extract_claims(body, **HIVE), "config") == [
            "hive.exec.parallel", "hive.metastore.uris"]

    @pytest.mark.parametrize("text", [
        "http://hive.apache.org/docs/latest",   # URL
        "mail dev@hive.apache.org",              # e-mail
        "org.apache.hadoop.hive.ql.exec.Task",   # package inside a class name
        "hive.ql.exec.Operator does it",         # package prefix of a class
        "copy hive.default.xml",                 # file name
        "call hive.util.helper.run()",           # method call
    ])
    def test_non_keys_are_not_config_claims(self, text):
        assert values(extract_claims(f"<p>{text}</p>", **HIVE), "config") == []

    def test_camel_case_keys_are_skipped_not_truncated(self):
        claims = extract_claims("<p>dfs.blockreport.intervalMsec</p>", [], config_prefixes=["dfs."])
        assert values(claims, "config") == []

    def test_sentence_final_period_is_not_part_of_the_key(self):
        claims = extract_claims("<p>Enable hive.exec.parallel.</p>", **HIVE)
        assert values(claims, "config") == ["hive.exec.parallel"]

    def test_duplicates_collapse_and_code_context_is_recorded(self):
        body = ("<p>hive.exec.parallel matters.</p>"
                "<pre>hive.exec.parallel=true</pre><p>hive.exec.mode.local.auto</p>")
        claims = {c.value: c for c in extract_claims(body, **HIVE)}
        assert len(claims) == 2
        assert claims["hive.exec.parallel"].in_code
        assert not claims["hive.exec.mode.local.auto"].in_code


@pytest.fixture
def repo(tmp_path):
    files = {
        "ql/src/java/org/apache/foo/Bar.java":
            "package org.apache.foo;\npublic class Bar {\n  static class Inner {}\n}\nenum Mode {}\n",
        "core/src/main/scala/org/apache/foo/s/Obj.scala": "package org.apache.foo.s\nobject Obj\ntrait T\n",
        "common/src/java/org/apache/other/Moved.java": "package org.apache.other;\nclass Moved {}\n",
        "conf/foo-default.xml": "<property><name>foo.live.key</name></property>\n",
        "docs/config.xml": "<name>foo.removed.key</name>\n",
        "README.md": "foo.readme.only\n",
    }
    for rel, text in files.items():
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    return build_index(tmp_path)


class TestRepoIndex:
    def test_declared_types_from_package_and_declarations(self, repo):
        assert {"org.apache.foo.Bar", "org.apache.foo.Mode", "org.apache.foo.s.Obj",
                "org.apache.foo.s.T", "org.apache.other.Moved"} <= repo.classes

    def test_documentation_paths_and_prose_are_not_indexed_as_tokens(self, repo):
        assert repo.has_token("foo.live.key")
        assert not repo.has_token("foo.removed.key")   # only under docs/
        assert not repo.has_token("foo.readme.only")   # only in prose

    def test_namespace_prefix_lookup(self, repo):
        assert repo.is_namespace("foo.live") and not repo.is_namespace("foo.live.key")


class TestCheck:
    def test_class_statuses(self, repo):
        def status(value):
            return check_claim(Claim("class", value, "", False), repo)[0]
        assert status("org.apache.foo.Bar") == OK
        assert status("org.apache.foo.Moved") == MOVED
        assert status("org.apache.foo.Gone") == MISSING

    def test_config_statuses(self, repo):
        def status(value):
            return check_claim(Claim("config", value, "", False), repo)[0]
        assert status("foo.live.key") == OK
        assert status("foo.live") == NAMESPACE
        assert status("foo.removed.key") == MISSING


class TestRules:
    def test_selection_qualifies_then_ranks_by_recent_edits(self):
        stats = [
            {"project": "A", "filtered_pages": 500, "recent_pages": 9},    # too few recent
            {"project": "B", "filtered_pages": 49, "recent_pages": 40},    # too few pages
            {"project": "C", "filtered_pages": 60, "recent_pages": 12},
            {"project": "D", "filtered_pages": 80, "recent_pages": 30},
            {"project": "E", "filtered_pages": 90, "recent_pages": 30},
            {"project": "F", "filtered_pages": 70, "recent_pages": 50},
            {"project": "G", "filtered_pages": 55, "recent_pages": 11},
        ]
        assert rules.select_spaces(stats) == ["F", "D", "E", "C"]

    def test_sample_is_deterministic_and_order_independent(self):
        flags = [{"space": "S", "page_id": str(i), "kind": "class", "value": f"v{i}"}
                 for i in range(200)]
        shuffled = flags[:]
        random.Random(1).shuffle(shuffled)
        first = rules.sample_flags(flags)
        assert len(first) == rules.SAMPLE_SIZE
        assert first == rules.sample_flags(shuffled)

    def test_small_flag_sets_are_verified_in_full(self):
        flags = [{"space": "S", "page_id": "1", "kind": "class", "value": "v"}]
        assert rules.sample_flags(flags) == flags

    @staticmethod
    def worksheet(real, fp, when="2026-06-01T00:00:00.000Z"):
        return ([{"verdict": rules.REAL, "reason": "", "last_modified": when}] * real
                + [{"verdict": rules.FALSE_POSITIVE, "reason": "entity_exists",
                    "last_modified": when}] * fp)

    SCAN = datetime(2026, 9, 28, tzinfo=timezone.utc)

    def test_precision_boundary_is_inclusive(self):
        out = rules.decide(100, 50, self.worksheet(40, 10), self.SCAN)  # 0.80 exactly
        assert out["precision"] == 0.8 and out["verdict"] == "PASSED"

    def test_low_precision_kills(self):
        out = rules.decide(100, 50, self.worksheet(39, 11), self.SCAN)
        assert out["kills"] == ["K1a precision"]

    def test_low_prevalence_kills(self):
        out = rules.decide(1000, 50, self.worksheet(45, 5), self.SCAN)  # 5% x 0.9 = 4.5%
        assert out["kills"] == ["K1b prevalence"]

    def test_no_flags_kills_on_both(self):
        assert rules.decide(100, 0, [], self.SCAN)["kills"] == ["K1a precision", "K1b prevalence"]

    def test_fresh_but_wrong_counts_recent_real_flags_only(self):
        rows = (self.worksheet(3, 0, "2026-01-01T00:00:00.000Z")
                + self.worksheet(2, 0, "2019-01-01T00:00:00.000Z")
                + self.worksheet(0, 2, "2026-01-01T00:00:00.000Z"))
        out = rules.decide(100, 60, rows, self.SCAN)
        assert out["fresh_but_wrong"] == 3 and out["fresh_but_wrong_share"] == 0.6

    def test_unverified_or_unexplained_rows_are_rejected(self):
        with pytest.raises(ValueError):
            rules.decide(10, 5, [{"verdict": "", "reason": ""}], self.SCAN)
        with pytest.raises(ValueError):
            rules.decide(10, 5, [{"verdict": rules.FALSE_POSITIVE, "reason": "vibes"}], self.SCAN)

    @pytest.mark.parametrize("text", ["2024-09-28T10:00:00.000Z", "2024-09-28T10:00:00.000+01:00"])
    def test_parse_when(self, text):
        assert rules.parse_when(text).year == 2024


class TestConfluence:
    def fake(self, pages_per_call):
        calls = []

        def fetch(url):
            calls.append(url)
            n = len(calls) - 1
            results = [{"id": str(10 * n + i), "title": f"P{n}{i}",
                        "version": {"when": "2025-01-01T00:00:00.000Z"},
                        "ancestors": [{"title": "Home"}],
                        "body": {"storage": {"value": "<p>x</p>"}},
                        "_links": {"webui": f"/display/S/P{n}{i}"}}
                       for i in range(pages_per_call[n])]
            links = {"next": "/more"} if n < len(pages_per_call) - 1 else {}
            return json.dumps({"results": results, "_links": links}).encode()
        return fetch, calls

    def test_pagination_and_page_fields(self):
        fetch, calls = self.fake([2, 2, 1])
        pages = list(iter_space_pages("https://w/confluence", "S", fetch, pause=0))
        assert [p.title for p in pages] == ["P00", "P01", "P10", "P11", "P20"]
        assert pages[0].ancestors == ("Home",) and pages[0].body == "<p>x</p>"
        assert pages[0].url == "https://w/confluence/display/S/P00"
        assert "start=2" in calls[1] and "start=4" in calls[2]

    def test_metadata_mode_does_not_request_bodies(self):
        fetch, calls = self.fake([1])
        list(iter_space_pages("https://w", "S", fetch, with_body=False, pause=0))
        assert "body.storage" not in calls[0]

    def test_cache_round_trip(self, tmp_path):
        fetch, calls = self.fake([2])
        first = load_or_fetch(tmp_path / "S.jsonl", "https://w", "S", fetch)
        again = load_or_fetch(tmp_path / "S.jsonl", "https://w", "S", fetch)
        assert first == again and len(calls) == 1


class TestCli:
    def test_sample_then_verdict(self, tmp_path):
        findings = tmp_path / "findings.jsonl"
        rows = [{"project": "Hive", "space": "Hive", "page_id": str(i), "page_title": "t",
                 "url": "u", "last_modified": "2026-05-01T00:00:00.000Z", "kind": "class",
                 "value": f"org.apache.hive.C{i}", "status": MISSING if i < 3 else OK,
                 "detail": "", "snippet": "", "in_code": False} for i in range(6)]
        findings.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
        worksheet = tmp_path / "worksheet.csv"
        assert main(["sample", "--findings", str(findings), "--out", str(worksheet)]) == 0
        with open(worksheet, newline="") as fh:
            sampled = list(csv.DictReader(fh))
        assert len(sampled) == 3
        for row in sampled:
            row["verdict"] = rules.REAL
        with open(worksheet, "w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(sampled[0]))
            writer.writeheader()
            writer.writerows(sampled)
        summary = tmp_path / "summary.json"
        summary.write_text(json.dumps({"scan_date": "2026-09-28T00:00:00+00:00",
                                       "claim_pages": 6, "flagged_pages": 3, "spaces": []}))
        out = tmp_path / "verdict.json"
        assert main(["verdict", "--summary", str(summary), "--worksheet", str(worksheet),
                     "--out", str(out)]) == 0
        assert json.loads(out.read_text())["verdict"] == "PASSED"
