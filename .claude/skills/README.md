# Claude Code skills

Vendored skill libraries, loaded automatically by every Claude Code session on
this repo. Claude picks the right skill from your request; you can also invoke
one by name (e.g. `/cro`, `/autoresearch`).

| Library | Skills | Source | Commit | License |
|---|---|---|---|---|
| Marketing | 49 | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | `7868cb9` | MIT |
| Research | 98 | [orchestra-research/ai-research-skills](https://github.com/orchestra-research/ai-research-skills) | `773a529` | MIT |

## Layout

All skills are flat, one directory per skill: `.claude/skills/<name>/SKILL.md`.

This is deliberate. Claude Code's loader scans only the immediate children of
the skills root and requires `<child>/SKILL.md` — it does **not** recurse. The
research library ships nested as `NN-category/<skill>/`, so it is flattened on
vendoring, using each skill's `name:` frontmatter as its directory name so the
two always agree. Flattening and upstream drift leave some links dangling;
those are re-pointed at vendor time (sibling links, the `autoresearch` routing
table, and rows naming skills the library does not actually ship).

Upstream `evals/` fixtures are omitted from the marketing library — they are
that repo's CI fixtures and no `SKILL.md` reads them.

## Do not hand-edit

This directory is generated. Edits are overwritten on the next sync. The
generator lives at `.claude/skills-sync/sync_skills.py`:

```bash
python3 .claude/skills-sync/sync_skills.py .          # rewrite in place
python3 .claude/skills-sync/sync_skills.py . --check   # exit 1 if out of date
```
