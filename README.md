# Raghav Sharma

I build AI evaluation and observability systems: tools that make it clear what shipped, what broke, what got slower, what cost more, and whether an eval actually means what it says.

The thread across the work is simple: keep the trace, show the evidence, and do not let a metric claim more than it can support.

## Current work

[lineage-invariant-objective-probing](https://github.com/Yatsuiii/lineage-invariant-objective-probing) - public preprint for a controlled protocol testing whether objective-predictive internal probes transfer across modified model descendants without mostly learning lineage shortcuts. It is a protocol, not a results paper.

[llmtrace](https://github.com/Yatsuiii/llmtrace) - self-hosted Go proxy that logs per-call LLM cost and latency, detects per-key spend anomalies, and runs an 8-tool Gemini agent to name the deploy that caused a spike. Live on Cloud Run.

[spendlint](https://github.com/Yatsuiii/spendlint) - pre-merge LLM cost gate for GitLab: reads each MR diff, projects the dollar delta against real traffic, and posts a verdict before it merges. The preventive counterpart to llmtrace.

[evalc](https://github.com/Yatsuiii/evalc) - compiles a natural-language eval criterion into a deterministic Python evaluator, self-tests it in a sandbox, and registers it as an Arize Phoenix evaluator. No LLM-as-judge.

## Earlier work

[ACE](https://github.com/Yatsuiii/api-causality-engine) - Rust CLI that runs multi-step API workflows as a typed state-machine graph, with static graph checks before any network call and cross-environment trace diffing.

[BrainConnect-ASD](https://github.com/Yatsuiii/Brain-Connectivity-GCN) - adversarial GCN with a Gradient Reversal Layer for site deconfounding on ABIDE resting-state fMRI. Fine-tuned Qwen2.5-7B for ASD diagnostic report generation on AMD MI300X.

## Stack

Go · Rust · Python · PostgreSQL · SQLite · PyTorch · Docker · Google Cloud Run · AWS

## Contact

raghavaryen@gmail.com · [LinkedIn](https://linkedin.com/in/raghav-sharma-74577931a)
