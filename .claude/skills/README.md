# Marketing skills

Claude Code skills for marketing work — CRO, copywriting, SEO/AI-SEO, paid ads,
email, pricing, retention, and growth. Claude picks the right one automatically
based on what you ask; you can also invoke one by name (e.g. `/cro`).

## Provenance

- Source: https://github.com/coreyhaines31/marketingskills
- Version: 2.10.0 (upstream commit `7868cb9`)
- License: MIT (Corey Haines)

Vendored copy of the upstream `skills/` directory. The upstream `evals/`
directories are omitted — they are the source repo's CI fixtures and are not
read by any `SKILL.md`.

## Updating

```bash
git clone --depth 1 https://github.com/coreyhaines31/marketingskills /tmp/ms
rsync -a --delete --exclude 'evals/' /tmp/ms/skills/ .claude/skills/
git checkout .claude/skills/README.md   # keep this file, then bump the version above
```
