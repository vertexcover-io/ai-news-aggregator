# Experiment Iteration 3 Results

Date: 2026-04-16T10:34:43.241Z

Candidates: 66 -> Dedup: 66 -> Shortlist: 30 -> Ranked: 10

### 1. I scaled a pure Spiking Neural Network (SNN) to 1.088B parameters from scratch. Ran out of budget, but here is what I found [R]
- **URL:** https://www.reddit.com/r/MachineLearning/comments/1skql34/i_scaled_a_pure_spiking_neural_network_snn_to/
- **Score:** 74.7
- **Engagement:** 101 pts, 51 comments
- **Summary:** An 18-year-old developer trained a 1.088B parameter Spiking Neural Network from scratch to convergence, achieving 93% sparsity and cross-lingual emergence, with code and weights released on GitHub.
- **Bullets:**
  - Proves direct SNN training at scale is feasible despite prior work suggesting vanishing gradients prevent convergence—major architectural validation
  - Maintains 93% sparsity (only 7% of neurons fire per token), offering potential memory and inference efficiency gains over dense models
  - Spontaneous cross-lingual emergence (Russian text generation) and memory routing shift at scale suggest SNNs learn meaningful structural patterns without explicit supervision
  - Full training checkpoint (12GB) and SFT framework released, enabling others to experiment with neuromorphic architectures without rebuilding infrastructure
  - Honest about limitations: text generation quality is still poor, loss is high due to budget constraints, and practical utility remains unproven
- **Bottom Line:** First-of-its-kind demonstration that pure SNNs can scale to 1B+ parameters from random init, opening a research direction for sparse, efficient language models.
- **Rationale:** Novelty and Actionability are the drivers. An 18-year-old indie developer successfully trained a 1.088B pure Spiking Neural Network from scratch to convergence (loss 4.4), proving that direct SNN training at scale is possible despite prior literature suggesting it fails. This is a genuine technical milestone with released code, weights, and training checkpoint. The work is honest about limitations (janky text generation, high loss due to budget constraints) and solicits specific technical feedback. High novelty in demonstrating feasibility; high actionability because the full checkpoint and framework are open-sourced. Penalized for incomplete training and lack of comparative benchmarks against standard LLMs.

### 2. PSA: Having issues with Qwen3.5 overthinking? Give it a tool, and it can help dramatically.
- **URL:** https://www.reddit.com/r/LocalLLaMA/comments/1skreyb/psa_having_issues_with_qwen35_overthinking_give/
- **Score:** 70.3
- **Engagement:** 60 pts, 21 comments
- **Summary:** Qwen3.5 overthinking can be dramatically reduced by enabling tools (even unused ones) and setting presence_penalty to 1.0-1.5, changing its reasoning style from verbose to concise.
- **Bullets:**
  - Tool availability fundamentally changes Qwen3.5's reasoning behavior: without tools it engages in verbose Gemini-like bullet-list reasoning; with tools it switches to short Claude-like traces
  - Sampling parameter tuning (presence_penalty 1.0-1.5) is the first-order fix; tool enablement is the second-order unlock for dramatic improvement
  - Even fake/unused tools trigger the behavioral shift, suggesting the model's reasoning strategy is conditional on tool availability rather than actual tool use
  - Immediate community validation: users report night-and-day difference in Open-WebUI with native function calling enabled, thought loops gone, thinking time reduced
  - Actionable for anyone running Qwen3.5 locally; applies to Open-WebUI, OpenCode, Hermes Agent, and other harnesses with tool support
- **Bottom Line:** Enable tools in Qwen3.5 to unlock concise reasoning and eliminate overthinking—a simple configuration change with outsized practical impact.
- **Rationale:** Practical-utility and Actionability drive this score. A PSA addressing a known Qwen3.5 issue (overthinking/verbose reasoning) with a concrete, tested fix: enable tools (even fake ones) and adjust sampling parameters. The post includes before/after screenshots showing the reasoning style change from verbose bullet-list (Gemini-like) to short Claude-like traces. Comments validate the fix immediately and add nuance (native function calling in Open-WebUI, tool availability changes reasoning behavior). High utility for practitioners struggling with Qwen3.5 in production. Penalized because the fix is relatively simple and the underlying mechanism isn't deeply explained.

### 3. Follow up post, decided to build the 2x RTX PRO 6000 tower.
- **URL:** https://i.redd.it/tmhom6f4g0vg1.jpeg
- **Score:** 69.7
- **Engagement:** 235 pts, 121 comments
- **Summary:** A detailed build log for a dual RTX PRO 6000 Blackwell workstation with Threadripper PRO 7965WX, 128GB DDR5 ECC RAM, and custom cooling, designed for multi-user concurrent inference.
- **Bullets:**
  - Complete parts list and power budgeting for a 192GB VRAM system (2× 96GB cards) with 1600W 80+ Titanium PSU on dedicated 20A circuit
  - Cooling strategy addresses GPU heat density: comments warn against air-cooling CPU when GPUs dump 1200W of heat, recommending AIO intake instead
  - Comments include proven reference config: Qwen3.5-27B-FP8 with speculative decoding achieving 80-90 tps single request, 250+ tps concurrent, leaving VRAM for embeddings and LoRAs
  - Practical guidance on avoiding memory cost trauma and leveraging MOE models with CPU+system RAM for inference work
  - Actionable for engineers planning serious local inference infrastructure, but lacks novel technical contribution
- **Bottom Line:** A well-documented reference build for dual-GPU local inference with proven performance numbers from community members running similar setups.
- **Rationale:** Practical-utility and Actionability drive this score. A detailed, real hardware build guide for a dual RTX PRO 6000 Blackwell tower with specific parts list, power budgeting, and cooling strategy. The post includes concrete specs (Threadripper PRO 7965WX, 128GB DDR5 ECC, 1600W PSU, custom cooling) and solicits expert feedback. Comments provide immediate value: one user shares their own RTX 6000 setup running Qwen3.5-27B-FP8 at 80-90 tps with multi-concurrent requests, offering a proven reference configuration. High utility for engineers building serious local inference infrastructure. Penalized because it's primarily a build log rather than novel technical insight.

### 4. OpenClaw has 250K GitHub stars. The only reliable use case I've found is daily news digests.
- **URL:** https://www.reddit.com/r/LocalLLaMA/comments/1skce14/openclaw_has_250k_github_stars_the_only_reliable/
- **Score:** 68.3
- **Engagement:** 843 pts, 327 comments
- **Summary:** After testing OpenClaw across 1000+ deployments and interviewing practitioners, the author found only one reliable use case: daily news summaries. The core issue is unreliable memory in persistent agents, making autonomous operation risky for real work.
- **Bullets:**
  - Memory degradation in persistent agents is a fundamental architectural constraint, not a fixable bug—context fills up and important details get forgotten unpredictably
  - The only validated use case is personalized news digests via web search and summarization, which can be replicated with simpler tools (cron + LLM API, ChatGPT scheduled tasks, Zapier)
  - Posts claiming full team automation either describe tasks already doable with standard AI tools or demos that work once but aren't production-reliable
  - Hype cycle driven by engagement metrics, not real utility—engineers should treat this as a fascinating experiment, not production infrastructure
  - Practical takeaway: if you have a weekend to tinker, it's interesting; otherwise, wait for memory reliability to actually work
- **Bottom Line:** OpenClaw is real software that runs, but its fundamental memory limitations make it unsuitable for autonomous work—only news digests hold up under scrutiny.
- **Rationale:** Novelty and Signal-vs-hype drive this score. The post provides concrete, hard-won field experience testing OpenClaw across 1000+ real deployments and conversations with practitioners. It cuts through hype with specific technical critique (memory reliability, context management) and identifies the actual working use case (news digests). The analysis is substantive and actionable—engineers can make informed decisions about whether to invest time. Comments add credibility with corroborating experiences. Penalized slightly because the core finding (agent memory is unreliable) is not entirely novel, but the systematic validation across real deployments is valuable.

### 5. Trained a 125M LM from scratch instead of fine-tuning GPT-2 — releasing weights + SFT framework for others to build on
- **URL:** https://www.reddit.com/r/LocalLLaMA/comments/1skp6y6/trained_a_125m_lm_from_scratch_instead_of/
- **Score:** 67.9
- **Engagement:** 55 pts, 17 comments
- **Summary:** A developer trained a 125M parameter language model from scratch with custom tokenizer, released base and instruct variants, and open-sourced the SFT framework for others to fine-tune.
- **Bullets:**
  - Clean small-scale base model stack designed for modification: custom 16k BPE tokenizer, WikiText-103 + TinyStories pretraining, LoRA-based instruction tuning on DailyDialog
  - Achieves 6.19 validation perplexity on WikiText-103 with 92k training steps—reasonable baseline for 125M scale without requiring multi-GPU infrastructure
  - Released SFT framework enables others to experiment with instruction tuning, tokenizer changes, and domain adaptation without rebuilding the pipeline
  - Honest about limitations: text generation quality is poor, not competing with modern 1B+ instruct models, goal is reproducible research foundation
  - Actionable for researchers and hobbyists exploring small-scale training; planning to scale to 390M next
- **Bottom Line:** A reproducible small-scale training pipeline and framework for experimenting with language model architecture and instruction tuning without heavy compute.
- **Rationale:** Novelty and Actionability drive this score. A developer released a 125M LM trained from scratch (custom tokenizer, no GPT-2 init) plus an instruct variant and SFT framework for others to build on. This is actionable for researchers experimenting with small-scale model training without multi-GPU infrastructure. The work is honest about limitations (not competing with 1B+ models, goal is clean base stack for modification). High novelty in providing a clean, reproducible small-scale training pipeline; high actionability because code and weights are released. Penalized because the model quality is admittedly poor and practical utility is unproven.

### 6. common/gemma4 : handle parsing edge cases by aldehir · Pull Request #21760 · ggml-org/llama.cpp
- **URL:** https://github.com/ggml-org/llama.cpp/pull/21760
- **Score:** 60.5
- **Engagement:** 30 pts, 21 comments
- **Summary:** Gemma 4 users must frequently recompile llama.cpp to stay current with bug fixes, particularly for parsing edge cases and thought tag leakage.
- **Bullets:**
  - Frequent llama.cpp updates required for Gemma 4 stability, particularly for tool call formatting and thought tag handling
  - PR #21760 addresses parsing edge cases that were causing malformed tool calls and thought tag leakage
  - Comments suggest workarounds: KoboldCpp (less frequent updates), exl3 (alternative backend)
  - Reflects broader issue: rapid development velocity creates friction for practitioners wanting stable, long-lived builds
  - Actionable for Gemma 4 users to understand the maintenance burden
- **Bottom Line:** Gemma 4 requires frequent llama.cpp recompilation to maintain stability, creating maintenance friction for local deployments.
- **Rationale:** Novelty and Signal-vs-hype are mixed. The post notes that Gemma 4 users must compile llama.cpp daily due to frequent bug fixes (specifically a PR handling parsing edge cases). This is a practical observation about development velocity and stability, but the post itself provides minimal context. Comments validate the issue and suggest workarounds (KoboldCpp, exl3). Useful for practitioners running Gemma 4 locally, but the post is more of a complaint than substantive analysis. Penalized for lack of depth and reliance on comments.

### 7. Ram-air setup and window vent for 1100w capable AI box
- **URL:** https://i.redd.it/t0jwhvixq0vg1.jpeg
- **Score:** 59.2
- **Engagement:** 80 pts, 77 comments
- **Summary:** An engineer built a ram-air cooling solution for a 1100W AI box using a window vent, achieving ~90% heat exhaust efficiency with cardboard and zip ties.
- **Bullets:**
  - Creative DIY cooling solution: ram-air intake through window vent achieves ~90% heat exhaust efficiency, comparable to open-case cooling
  - Practical tips from comments: position case above intake level to avoid water ingress, pull external air in summer to avoid exhausting AC, add HEPA filter
  - Low-cost materials (cardboard, zip ties) make it accessible for practitioners building high-power setups
  - Addresses real problem: office temperature management with 1100W+ heat output
  - Limited generalizability—solution is specific to one person's setup and window configuration
- **Bottom Line:** A practical DIY cooling solution for high-power local AI boxes using window vents and basic materials.
- **Rationale:** Practical-utility is the primary driver. A practitioner shares a creative cooling solution for a 1100W AI box: ram-air intake through a window vent, achieving ~90% heat exhaust efficiency. The post includes a photo and practical tips from comments (case above intake level, external air intake in summer, HEPA filter). High utility for engineers building high-power local setups. Penalized because the solution is specific to one person's setup and lacks systematic thermal analysis or generalizability.

### 8. What Is Elephant-Alpha ???
- **URL:** https://i.redd.it/gvmvmvxyfzug1.jpeg
- **Score:** 58.4
- **Engagement:** 213 pts, 107 comments
- **Summary:** A screenshot of an unknown model called Elephant-Alpha sparked speculation about its identity, speed (1000 token/s), and architecture (possibly diffusion-based).
- **Bullets:**
  - Model identity is unclear; comments speculate it could be Cohere Command or another provider's model
  - Reported speed of 1000 token/s is notable but unverified and lacks context about hardware or task
  - Diffusion-based architecture suggested by response pattern (long pause followed by instant text wall), but unconfirmed
  - No technical details, benchmarks, or availability information provided
  - Actionable value is minimal without model identity or access information
- **Bottom Line:** A mysterious model screenshot with high speculation but minimal substantive information or actionability.
- **Rationale:** Novelty is the primary driver, but limited. The post is a screenshot of an unknown model (Elephant-Alpha) with no context. Comments speculate about identity and characteristics (1000 token/s speed, possibly diffusion-based, possibly Cohere). The discussion is interesting but highly speculative. No actionable information provided. Penalized heavily for lack of context, unverified claims, and minimal substantive content.

### 9. Kimi K2.6 imminent
- **URL:** https://i.redd.it/3wr3ia70fyug1.jpeg
- **Score:** 58.2
- **Engagement:** 352 pts, 74 comments
- **Summary:** Kimi K2.6 model release was announced as imminent, with community members expressing anticipation and noting it has already dropped.
- **Bullets:**
  - Kimi K2.5 is well-regarded in the community for prose quality and unique characteristics compared to other releases
  - K2.6 release timing was uncertain (post suggested 2 weeks, but model appears to have already dropped based on comments)
  - No technical details, benchmarks, or performance comparisons provided in the post itself
  - Community engagement is high but mostly anticipatory rather than analytical
  - Actionable value is low without model details or availability information
- **Bottom Line:** A model release announcement with minimal technical context and community engagement focused on availability rather than capabilities.
- **Rationale:** Novelty and Signal-vs-hype are mixed here. The post is a screenshot with minimal context announcing Kimi K2.6 is imminent. Comments reveal the post is somewhat outdated (K2.6 has already dropped, as shown in a follow-up comment with a screenshot). The model itself is novel (Kimi K2.5 is well-regarded in the community), but the post provides no technical details, benchmarks, or actionable information. High community engagement but mostly expressing anticipation rather than substantive analysis. Penalized for lack of concrete information and being superseded by events.

### 10. Ryan Lee from MiniMax posts article on the license stating it's mostly for API providers that did a poor job serving M2.1/M2.5 and may update the license for regular users!
- **URL:** https://i.redd.it/l7xvpse6iyug1.jpeg
- **Score:** 57.6
- **Engagement:** 421 pts, 46 comments
- **Summary:** MiniMax founder Ryan Lee clarified that the M2.7 license change targets API providers with poor model serving, not regular local users, with potential updates for regular users.
- **Bullets:**
  - License restriction applies to providers serving the model to users for profit, not to local use or using generated code commercially
  - Targets API providers (like OpenRouter) that were serving models with wrong settings or misrepresenting quality
  - Potential for license updates specifically for regular users, suggesting the restriction may be temporary or refined
  - Comments note the distinction between commercial use of generated code (allowed) vs. serving the model as a provider (restricted)
  - Actionable for practitioners deciding whether to use M2.7 locally; regular users appear unaffected
- **Bottom Line:** MiniMax's license change targets poor API providers, not local users—regular practitioners can likely use M2.7 without restriction.
- **Rationale:** Signal-vs-hype and Actionability are the drivers. Ryan Lee (MiniMax founder) clarified the M2.7 license change: it targets API providers serving models poorly, not regular users. The post includes a screenshot and link to the official response, cutting through confusion about commercial use restrictions. Comments provide nuance: the license prevents serving the model to users for profit, not using generated code commercially. High signal-to-noise ratio; actionable for practitioners deciding whether to use M2.7 locally. Penalized because the core information is a screenshot with limited context, and the license implications remain somewhat ambiguous.
