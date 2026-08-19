# Claude Code skills

Vendored skill libraries, loaded automatically by every Claude Code session on
this repo. Claude picks the right skill from your request; you can also invoke
one by name (e.g. `/cro`, `/autoresearch`).

| Library | Skills | Source | Commit | License |
|---|---|---|---|---|
| Marketing | 49 | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | `c6ea128` | MIT |
| Research | 98 | [orchestra-research/ai-research-skills](https://github.com/orchestra-research/ai-research-skills) | `773a529` | MIT |
| Postiz | 1 | [gitroomhq/postiz-agent](https://github.com/gitroomhq/postiz-agent) | `885e1b0` | AGPL-3.0 |
| Zernio | 1 | [zernio-dev/zernio-api](https://github.com/zernio-dev/zernio-api) | `6a8356f` | MIT |

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

The Postiz library ships as a single repo-root skill rather than a directory
of many, so only what its `SKILL.md` links to (its sibling `*.md` docs and
`examples/`) is vendored — not its own CLI source (`src/`, `server/`) or
build config, which are for building and publishing that npm package, not
for Claude to read.

## Postiz is operational, not just reference

Unlike the other two libraries, this skill documents a real CLI (`postiz`)
that can publish live content to real social accounts. Installing the skill
does nothing by itself: every `postiz` command hard-fails without
credentials (`postiz auth:login` or `export POSTIZ_API_KEY=...`), which the
skill never sets up on its own — that is a separate, explicit step for
whoever wants Claude to actually post on their behalf.

## Do not hand-edit

This directory is generated. Edits are overwritten on the next sync. The
generator lives at `.claude/skills-sync/sync_skills.py`:

```bash
python3 .claude/skills-sync/sync_skills.py .            # sync in place
python3 .claude/skills-sync/sync_skills.py . --check     # exit 1 if out of date
python3 .claude/skills-sync/sync_skills.py . --rebuild   # drop all, re-vendor
```

## What gets deleted

`.claude/skills-sync/manifest.json` records which skills the generator owns.
Only those are ever removed — so a skill you write yourself is safe, while a
skill an upstream renames or drops is pruned instead of lingering as a stale
near-duplicate that competes with its replacement for routing.

Nothing here expires or degrades on its own; these are plain markdown files
read fresh at every session start. There is no reason to wipe them on a
schedule. `--rebuild` exists for when you want a clean re-vendor on demand.
