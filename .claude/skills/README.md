# Claude Code skills

Vendored skill libraries, loaded automatically by every Claude Code session on
this repo. Claude picks the right skill from your request; you can also invoke
one by name (e.g. `/cro`, `/autoresearch`).

## Libraries

| Library | Skills | Source | Version | License |
|---|---|---|---|---|
| Marketing | 49 | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | 2.10.0 (`7868cb9`) | MIT |
| AI research | 98 | [orchestra-research/ai-research-skills](https://github.com/orchestra-research/ai-research-skills) | 1.2.0 (`773a529`) | MIT |

**Marketing** — CRO, copywriting, SEO / AI-SEO / programmatic SEO, paid ads and
ad creative, email and cold email, SMS, social, pricing, offers, onboarding,
retention, launch, PR, competitor research, analytics, attribution, A/B testing.

**AI research** — model architectures, tokenization, fine-tuning, mechanistic
interpretability, data processing, post-training / RL, safety and alignment,
distributed training, GPU infrastructure, quantization and optimization,
evaluation, inference serving, MLOps, agents, RAG, prompt engineering,
observability, multimodal, emerging techniques, ML paper writing, research
ideation, and the `autoresearch` orchestrator.

## Layout

All skills are flat, one directory per skill: `.claude/skills/<name>/SKILL.md`.

This is deliberate. Claude Code's loader scans only the immediate children of
the skills root and requires `<child>/SKILL.md` — it does **not** recurse. The
research library ships nested as `NN-category/<skill>/`, so it is flattened on
vendoring, using each skill's `name:` frontmatter as its directory name so the
two always agree.

Flattening required three routing fixes, applied to the vendored copy:

- `miles-rl-training` — sibling link retargeted to `../slime-rl-training/`.
- `autoresearch` (`SKILL.md` and `references/skill-routing.md`) — category
  paths (`05-data-processing/`, …) rewritten to the flat skill names they
  resolve to.
- `autoresearch/references/skill-routing.md` — 16 rows pointed at skills the
  upstream library does not actually ship (Torchtune, Inspect AI, Quanto,
  Smolagents, Claude Agent SDK, Milvus, Qwen2-VL, Pixtral, Florence-2, ColPali)
  or used name variants (`wandb`, `fsdp`, `trl`, …). Variants were mapped to the
  real skill; genuinely absent ones are marked "not in this library" instead of
  linking to a path that does not exist.

Upstream `evals/` fixtures are omitted from the marketing library — they are
that repo's CI fixtures and no `SKILL.md` reads them.

## Updating

Do not hand-edit vendored skills; re-vendor instead, then re-apply the fixes
above and bump the versions in the table.

```bash
git clone --depth 1 https://github.com/coreyhaines31/marketingskills /tmp/ms
rsync -a --delete --exclude 'evals/' /tmp/ms/skills/ /tmp/staged/
# research library: flatten NN-category/<skill>/ -> <frontmatter name>/
```
