# Raghav Sharma

Builder focused on operational tooling and applied ML systems. Most of my work is in Go and Rust, across a recurring theme: correlating what shipped to what broke (or what cost more).

## The trace family

Three projects, one pattern: anomaly detection + deploy correlation + causal attribution. Applied across domains.

| Project | Domain | What it does |
|---|---|---|
| [llmtrace](https://github.com/Yatsuiii/llmtrace) | LLM ops | Self-hosted Go proxy that records per-call token cost and latency, detects per-key spend anomalies, and runs a Gemini agent to name the deploy that caused the spike. Live on Cloud Run. |
| [costtrace](https://github.com/Yatsuiii/costtrace) | Cloud FinOps | CLI that correlates AWS cost anomalies to GitHub Actions deploys via CloudTrail resource events and a multi-signal confidence scorer. |
| [ACE](https://github.com/Yatsuiii/api-causality-engine) | Dev tooling | Rust CLI that models multi-step API workflows as typed state machines and diffs execution traces across environments to surface why staging and production diverge. Distributed via Homebrew, Docker, and GitHub Actions CI/CD. |

Same additive lineage-scoring rubric in all three. Different domains, same architectural answer.

## ML systems

[BrainConnect-ASD](https://github.com/Yatsuiii/Brain-Connectivity-ASD) -- adversarial GCN with a Gradient Reversal Layer for site deconfounding on 1,102 ABIDE subjects (fMRI). Mean AUC 0.7872 across 20 leave-one-site-out splits. Fine-tuned Qwen2.5-7B for ASD diagnostic report generation. Ran on AMD MI300X for the AMD Developer Hackathon 2026.

## Stack

Go · Rust · Python · SQLite · PyTorch · AWS · Docker · Google Cloud Run

## Contact

raghavaryen@gmail.com · [LinkedIn](https://linkedin.com/in/raghav-sharma-74577931a)
