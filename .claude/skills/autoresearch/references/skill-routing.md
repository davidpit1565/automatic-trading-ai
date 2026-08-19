# Skill Routing: When to Use Which Domain Skill

The autoresearch skill orchestrates — domain skills execute. This reference maps research activities to the skills library.

## Routing Principle

When you encounter a domain-specific task during research, search the skills library for the right tool. Read the SKILL.md of the relevant skill before starting — it contains workflows, common issues, and production-ready code examples.

## Complete Routing Map

### Data and Preprocessing

| Task | Skill | Location |
|---|---|---|
| Large-scale data processing | Ray Data | `ray-data` |
| Data curation and filtering | NeMo Curator | `nemo-curator` |
| Custom tokenizer training | HuggingFace Tokenizers | `huggingface-tokenizers` |
| Subword tokenization | SentencePiece | `sentencepiece` |

### Model Architecture and Training

| Task | Skill | Location |
|---|---|---|
| Large-scale pretraining | Megatron-Core | `training-llms-megatron` |
| Lightweight LLM training | LitGPT | `implementing-llms-litgpt` |
| State-space models | Mamba | `mamba-architecture` |
| Linear attention models | RWKV | `rwkv-architecture` |
| Small-scale pretraining | NanoGPT | `nanogpt` |

### Fine-tuning

| Task | Skill | Location |
|---|---|---|
| Multi-method fine-tuning | Axolotl | `axolotl` |
| Template-based fine-tuning | LLaMA-Factory | `llama-factory` |
| Fast LoRA fine-tuning | Unsloth | `unsloth` |
| PyTorch-native fine-tuning | Torchtune | not in this library |

### Post-training (RL / Alignment)

| Task | Skill | Location |
|---|---|---|
| PPO, DPO, SFT pipelines | TRL | `fine-tuning-with-trl` |
| Group Relative Policy Optimization | GRPO | `grpo-rl-training` |
| Scalable RLHF | OpenRLHF | `openrlhf-training` |
| Reference-free alignment | SimPO | `simpo-training` |

### Interpretability

| Task | Skill | Location |
|---|---|---|
| Transformer circuit analysis | TransformerLens | `transformer-lens-interpretability` |
| Sparse autoencoder training | SAELens | `sparse-autoencoder-training` |
| Intervention experiments | NNsight | `nnsight-remote-interpretability` |
| Causal tracing | Pyvene | `pyvene-interventions` |

### Distributed Training

| Task | Skill | Location |
|---|---|---|
| ZeRO optimization | DeepSpeed | `deepspeed` |
| Fully sharded data parallel | FSDP | `pytorch-fsdp2` |
| Multi-GPU abstraction | Accelerate | `huggingface-accelerate` |
| Training framework | PyTorch Lightning | `pytorch-lightning` |
| Distributed data + training | Ray Train | `ray-train` |

### Evaluation

| Task | Skill | Location |
|---|---|---|
| Standard LLM benchmarks | lm-evaluation-harness | `evaluating-llms-harness` |
| NeMo-integrated evaluation | NeMo Evaluator | `nemo-evaluator-sdk` |
| Custom eval tasks | Inspect AI | not in this library |

### Inference and Serving

| Task | Skill | Location |
|---|---|---|
| High-throughput serving | vLLM | `serving-llms-vllm` |
| NVIDIA-optimized inference | TensorRT-LLM | `tensorrt-llm` |
| CPU / edge inference | llama.cpp | `llama-cpp` |
| Structured generation serving | SGLang | `sglang` |

### Experiment Tracking

| Task | Skill | Location |
|---|---|---|
| Full experiment tracking | Weights & Biases | `weights-and-biases` |
| Open-source tracking | MLflow | `mlflow` |
| Training visualization | TensorBoard | `tensorboard` |

### Optimization Techniques

| Task | Skill | Location |
|---|---|---|
| Efficient attention | Flash Attention | `optimizing-attention-flash` |
| 4/8-bit quantization | bitsandbytes | `quantizing-models-bitsandbytes` |
| GPTQ quantization | GPTQ | `gptq` |
| AWQ quantization | AWQ | `awq-quantization` |
| GGUF format (llama.cpp) | GGUF | `gguf-quantization` |
| PyTorch-native quantization | Quanto | not in this library |

### Safety and Alignment

| Task | Skill | Location |
|---|---|---|
| Constitutional AI training | Constitutional AI | `constitutional-ai` |
| Content safety classification | LlamaGuard | `llamaguard` |
| Guardrail pipelines | NeMo Guardrails | `nemo-guardrails` |
| Prompt injection detection | Prompt Guard | `prompt-guard` |

### Infrastructure

| Task | Skill | Location |
|---|---|---|
| Serverless GPU compute | Modal | `modal-serverless-gpu` |
| Multi-cloud orchestration | SkyPilot | `skypilot-multi-cloud-orchestration` |
| GPU cloud instances | Lambda Labs | `lambda-labs-gpu-cloud` |

### Agents and RAG

| Task | Skill | Location |
|---|---|---|
| Agent pipelines | LangChain | `langchain` |
| Knowledge retrieval agents | LlamaIndex | `llamaindex` |
| Lightweight agents | Smolagents | not in this library |
| Claude-based agents | Claude Agent SDK | not in this library |
| Vector store (local) | Chroma | `chroma` |
| Vector similarity search | FAISS | `faiss` |
| Text embeddings | Sentence Transformers | `sentence-transformers` |
| Managed vector DB | Pinecone | `pinecone` |
| Scalable vector DB | Milvus | not in this library |

### Prompt Engineering and Structured Output

| Task | Skill | Location |
|---|---|---|
| Prompt optimization | DSPy | `dspy` |
| Structured LLM output | Instructor | `instructor` |
| Constrained generation | Guidance | `guidance` |
| Grammar-based generation | Outlines | `outlines` |

### Multimodal

| Task | Skill | Location |
|---|---|---|
| Vision-language models | CLIP | `clip` |
| Speech recognition | Whisper | `whisper` |
| Visual instruction tuning | LLaVA | `llava` |
| Vision-language (Qwen) | Qwen2-VL | not in this library |
| Vision-language (Mistral) | Pixtral | not in this library |
| Visual understanding | Florence-2 | not in this library |
| Document retrieval | ColPali | not in this library |

### Observability

| Task | Skill | Location |
|---|---|---|
| LLM tracing and debugging | LangSmith | `langsmith-observability` |
| LLM observability platform | Phoenix | `phoenix-observability` |

### Emerging Techniques

| Task | Skill | Location |
|---|---|---|
| Mixture of Experts training | MoE Training | `moe-training` |
| Combining trained models | Model Merging | `model-merging` |
| Extended context windows | Long Context | `long-context` |
| Faster inference via drafting | Speculative Decoding | `speculative-decoding` |
| Teacher-student compression | Knowledge Distillation | `knowledge-distillation` |
| Reducing model size | Model Pruning | `model-pruning` |

### Research Output

| Task | Skill | Location |
|---|---|---|
| Generate research ideas | Research Ideation | `brainstorming-research-ideas`, `creative-thinking-for-research` |
| Write publication-ready paper | ML Paper Writing | `academic-plotting`, `ml-paper-writing`, `presenting-conference-talks`, `systems-paper-writing` |

## Common Research Workflows

### "I need to fine-tune a model and evaluate it"

1. Pick fine-tuning skill based on needs (Unsloth for speed, Axolotl for flexibility)
2. Use lm-evaluation-harness for standard benchmarks
3. Track with W&B or MLflow

### "I need to understand what the model learned"

1. Use TransformerLens for circuit-level analysis
2. Train SAEs with SAELens for feature-level understanding
3. Run interventions with NNsight or Pyvene

### "I need to do RL training"

1. Start with TRL for standard PPO/DPO
2. Use GRPO skill for DeepSeek-R1 style training
3. Scale with OpenRLHF if needed

### "I need to run experiments on cloud GPUs"

1. Modal for quick serverless runs
2. SkyPilot for multi-cloud optimization
3. Lambda Labs for dedicated instances

## Finding Skills

If you're not sure which skill to use:

```bash
# Search by keyword in skill names
ls */*/SKILL.md | head -20

# Search skill descriptions for a keyword
grep -l "keyword" */*/SKILL.md
```

Or search the repository's README.md which lists all skills with descriptions.
