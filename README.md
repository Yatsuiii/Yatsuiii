# Raghav Sharma

I build infrastructure for AI and developer systems — observability, evaluation, workflow validation, and the task queues underneath. Mostly Go and Rust.

Recurring theme across the work: **make systems explain themselves.** Why the bill moved, which deploy broke staging, whether an eval actually passed, which job died and why.

## Infrastructure & dev tooling

| Project | What it does |
|---|---|
| [llmtrace](https://github.com/Yatsuiii/llmtrace) | Self-hosted Go proxy that logs per-call LLM cost and latency, detects per-key spend anomalies, and runs an 8-tool Gemini agent to name the exact deploy that caused a spike. Live on Cloud Run. |
| [evalc](https://github.com/Yatsuiii/evalc) | Compiles a natural-language eval criterion into a deterministic Python evaluator — no LLM-as-judge — self-tests it in a sandbox, and registers it as an Arize Phoenix evaluator. |
| [ACE](https://github.com/Yatsuiii/api-causality-engine) | Rust CLI that runs multi-step API workflows as a typed state-machine graph: 21 static graph checks before any network call, plus cross-environment trace diffing. Shipped via Homebrew, Docker, GitHub Actions. |
| [rivet](https://github.com/Yatsuiii/rivet) | Postgres-backed task queue for Go. `SKIP LOCKED` dequeue, visibility-timeout crash recovery, at-least-once delivery. No Redis, no broker. |

## ML systems

[BrainConnect-ASD](https://github.com/Yatsuiii/Brain-Connectivity-GCN) — adversarial GCN with a Gradient Reversal Layer for site deconfounding on 1,102 ABIDE subjects (fMRI). Mean AUC 0.7872 across 20 leave-one-site-out splits. Fine-tuned Qwen2.5-7B for ASD diagnostic report generation. Ran on AMD MI300X for the AMD Developer Hackathon 2026.

## Stack

Go · Rust · Python · PostgreSQL · SQLite · PyTorch · Docker · Google Cloud Run · AWS

## Contact

raghavaryen@gmail.com · [LinkedIn](https://linkedin.com/in/raghav-sharma-74577931a)
