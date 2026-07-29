# Raghav Sharma

I build tools that make messy systems easier to inspect: what shipped, what broke, what got slower, what cost more, and whether an evaluation actually means what it says.

Most of my work is infrastructure in Go and Rust. The same thread runs through the ML work too: make the hidden state legible, keep the evidence attached, and do not let a metric claim more than it can support.

## Infrastructure and dev tooling

| Project | What it does |
|---|---|
| [llmtrace](https://github.com/Yatsuiii/llmtrace) | Self-hosted Go proxy that logs per-call LLM cost and latency, detects per-key spend anomalies, and runs an 8-tool Gemini agent to name the exact deploy that caused a spike. Live on Cloud Run. |
| [spendlint](https://github.com/Yatsuiii/spendlint) | Pre-merge LLM cost gate for GitLab: reads each MR diff, projects the dollar delta against real traffic, and posts a verdict before it merges. The preventive counterpart to llmtrace. Live on Cloud Run. |
| [evalc](https://github.com/Yatsuiii/evalc) | Compiles a natural-language eval criterion into a deterministic Python evaluator, self-tests it in a sandbox, and registers it as an Arize Phoenix evaluator. No LLM-as-judge. |
| [ACE](https://github.com/Yatsuiii/api-causality-engine) | Rust CLI that runs multi-step API workflows as a typed state-machine graph: 21 static graph checks before any network call, plus cross-environment trace diffing. Shipped via Homebrew, Docker, GitHub Actions. |
| [rivet](https://github.com/Yatsuiii/rivet) | Postgres-backed task queue for Go. `SKIP LOCKED` dequeue, visibility-timeout crash recovery, at-least-once delivery. No Redis, no broker. |

## ML systems and interpretability

[BrainConnect-ASD](https://github.com/Yatsuiii/Brain-Connectivity-GCN) - adversarial GCN with a Gradient Reversal Layer for site deconfounding on ABIDE resting-state fMRI. Fine-tuned Qwen2.5-7B for ASD diagnostic report generation. Ran on AMD MI300X for the AMD Developer Hackathon 2026.

[lineage-invariant-objective-probing](https://github.com/Yatsuiii/lineage-invariant-objective-probing) - public preprint for a controlled protocol testing whether objective-predictive internal probes transfer across modified model descendants without mostly learning lineage shortcuts. No experiments claimed; the point is the protocol, controls, and falsification rules.

## Stack

Go · Rust · Python · PostgreSQL · SQLite · PyTorch · Docker · Google Cloud Run · AWS

## Contact

raghavaryen@gmail.com · [LinkedIn](https://linkedin.com/in/raghav-sharma-74577931a)
