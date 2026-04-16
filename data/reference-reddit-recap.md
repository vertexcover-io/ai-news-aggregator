# Reference: smol.ai Newsletter Reddit Recap (2026-04-13)

Source: https://news.smol.ai/issues/26-04-13-not-much#rlocalllama--rlocalllm-recap

## Items (ranked order from newsletter)

### 1. Best Local LLMs - Apr 2026
- **URL:** https://www.reddit.com/r/LocalLLaMA/comments/1sknx6n/best_local_llms_apr_2026/
- **Activity:** 440
- **Summary:** The discussion highlights recent advances in local LLMs, featuring releases like Qwen3.5, Gemma4, and GLM-5.1. Minimax-M2.7 is noted for accessibility, while PrismML Bonsai introduces effective 1-bit models. The thread categorizes models by VRAM requirements from unlimited (>128GB) to small (<8GB).
- **Bullets:**
  - User request for granular classification beyond simple labels for models exceeding 128GB VRAM
  - Growing focus on specialized local LLMs for domains including medical, legal, accounting, and mathematics
  - Interest in agentic coding and tool use capabilities for autonomous task execution

### 2. Audio processing landed in llama-server with Gemma-4
- **URL:** https://www.reddit.com/r/LocalLLaMA/comments/1sjhxrw/audio_processing_landed_in_llamaserver_with_gemma4/
- **Activity:** 494
- **Summary:** llama.cpp now integrates audio processing with native Speech-to-Text support via Gemma-4 E2A and E4A models, eliminating separate Whisper pipelines. However, users report issues with extended audio transcriptions, including errors and sentence looping.
- **Bullets:**
  - Recommended setup uses "E4B as Q8_XL quant with BF16 mmproj" for optimal performance
  - Configuration variations degrade results significantly
  - Specific templates required for accurate transcription and translation
  - Some users note Voxtral performs better for longer segments
  - Spanish testing indicates reasonable accuracy, potentially surpassing Whisper in certain languages

### 3. Speculative Decoding works great for Gemma 4 31B with E2B draft (+29% avg, +50% on code)
- **URL:** https://www.reddit.com/r/LocalLLaMA/comments/1sjct6a/speculative_decoding_works_great_for_gemma_4_31b/
- **Activity:** 527
- **Summary:** Implementation of speculative decoding using Gemma 4 31B with Gemma 4 E2B (4.65B) as draft model achieved significant performance gains on an RTX 5090 GPU with 128K context.
- **Bullets:**
  - "+29% average speedup, +50% on code generation tasks"
  - Vocabulary compatibility between models eliminates token translation overhead
  - Critical issue: "add_bos_token" metadata mismatch in early GGUF versions resolved via re-downloading
  - Setting "--parallel 1" prevents VRAM overuse
  - 5070Ti/5060Ti combo users reported throughput increase from ~25 to 40 tokens/second at 128K context

### 4. MiniMax M2.7 Licensing Clarification
- **URL:** https://www.reddit.com/r/LocalLLaMA/comments/1skabyf/ryan_lee_from_minimax_posts_article_on_the/
- **Activity:** 451
- **Summary:** MiniMax CEO Ryan Lee clarified that self-hosting M2.7 for code writing is "permitted and free," though the current license lacks detail and will receive updates. This addresses concerns about licensing clarity, particularly regarding API provider restrictions.
- **Bullets:**
  - Skepticism about licensing clarity and intent
  - Many API providers misrepresent model quality, with some failing to serve advertised models
  - Licenses restricting commercial use can inadvertently complicate legitimate self-hosting efforts
  - Legal nuances in messaging: earlier communications mentioned restrictions on "commercial use of code writing," creating inconsistency

### 5. Local Minimax M2.7, GTA benchmark
- **URL:** https://www.reddit.com/r/LocalLLaMA/comments/1sk70ph/local_minimax_m27_gta_benchmark/
- **Activity:** 383
- **Summary:** Benchmark testing used Minimax M2.7 to create a 3D GTA-like web-based experience. While GLM 5 excels in detail without explicit instruction, M2.7 performed well when specifically tasked with adding environmental elements.
- **Bullets:**
  - Ran at "IQ2_XXS" quantization for maximum speed
  - Model maintained coherence and capability despite aggressive compression
  - GLM 5 provides superior character detail without additional prompts
  - Minimax M2.7 demonstrated attention to environmental detail

### 6. Local models are a godsend for personal matters
- **URL:** https://www.reddit.com/r/LocalLLaMA/comments/1ska9av/local_models_are_a_godsend_when_it_comes_to/
- **Activity:** 443
- **Summary:** Users leverage local models like Gemma 4 26B A4B (supporting 256k context) for analyzing personal journals and documents with over 100k tokens, gaining insights into recurring themes while maintaining privacy.
- **Bullets:**
  - Processing 10+ years of personal documents into knowledge bases for querying
  - Retrieving specific personal data like past expenses and associations
  - Avoiding commercial pressures of flagship models
  - Models function as cognitive externalization tools without therapeutic claims

### 7. NVIDIA RTX PRO 6000 Blackwell local-first build
- **URL:** https://www.reddit.com/r/LocalLLM/comments/1sk3zng/just_got_my_hands_on_one_of_these_building/
- **Activity:** 441
- **Summary:** A builder acquired an NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition GPU for multi-user concurrent inference, paired with a 9950X CPU, 128GB RAM, and ProArt motherboard.
- **Bullets:**
  - Exploring vLLM and llama.cpp for multi-user efficiency
  - RTX 6000 setup running Qwen3.5-27B-FP8 with kv cache dtype at fp8_e4m3
  - Maximum context length: 160k tokens utilizing only 55% of VRAM
  - Performance metrics: 80-90 tps for single requests and over 250 tps concurrent
  - Additional capacity for Whisper-large-v3, embedding models, reranker models, and swappable LoRAs
