#!/usr/bin/env python3
"""Rebuild a repo's .claude/skills/ from the upstream skill libraries.

Idempotent: run it and .claude/skills/ ends up matching the upstreams.

    python3 sync_skills.py REPO             # sync in place
    python3 sync_skills.py REPO --check     # exit 1 if out of date, write nothing
    python3 sync_skills.py REPO --rebuild   # drop every managed skill, re-vendor

Ownership is tracked in .claude/skills-sync/manifest.json. Only skills listed
there are ever deleted, so a skill you write yourself is never touched — but a
skill the upstream renames or drops is pruned instead of lingering forever.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, pathlib

LIBS = {
    "marketing": {
        "url": "https://github.com/coreyhaines31/marketingskills",
        "pin": None, "subdir": "skills", "layout": "flat",
        "exclude_dirs": {"evals"}, "license": "MIT",
    },
    "research": {
        "url": "https://github.com/orchestra-research/ai-research-skills",
        "pin": None, "subdir": "", "layout": "nested",
        "exclude_dirs": set(), "license": "MIT",
    },
    "postiz": {
        "url": "https://github.com/gitroomhq/postiz-agent",
        "pin": None, "subdir": "", "layout": "single",
        "exclude_dirs": set(), "license": "AGPL-3.0",
    },
}

# Rows in the research library's routing table naming skills it does not ship.
ABSENT = {"torchtune", "inspect-ai", "quanto", "smolagents", "claude-agent-sdk",
          "milvus", "qwen2-vl", "pixtral", "florence-2", "colpali"}
# ...and rows using a name variant of a skill it does ship.
ALIAS = {"hf-tokenizers": "huggingface-tokenizers", "trl": "trl-fine-tuning",
         "transformerlens": "transformer-lens", "fsdp": "pytorch-fsdp2",
         "lm-eval-harness": "lm-evaluation-harness", "wandb": "weights-and-biases"}

CAT_RE  = re.compile(r'`?((?:0-autoresearch-skill|\d\d-[a-z][a-z0-9-]*))/([a-z0-9][a-z0-9._-]*)/?`?')
BARE_RE = re.compile(r'`(\d\d-[a-z][a-z0-9-]*)/`')

MANIFEST = "manifest.json"


def run(*cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def clone(url, pin, dest):
    env = dict(os.environ, GIT_LFS_SKIP_SMUDGE="1")
    if pin:
        run("git", "clone", "--filter=blob:none", "--no-checkout", url, str(dest), env=env)
        run("git", "-C", str(dest), "checkout", pin, env=env)
    else:
        run("git", "clone", "--depth", "1", url, str(dest), env=env)
    return run("git", "-C", str(dest), "rev-parse", "--short", "HEAD").stdout.strip()


def frontmatter_name(skill_md):
    m = re.search(r'^name:\s*["\']?(.+?)["\']?\s*$',
                  skill_md.read_text(encoding="utf-8", errors="replace"), re.M)
    return m.group(1).strip() if m else None


def prune_excluded(root, exclude_dirs):
    if not exclude_dirs:
        return
    for d in sorted(root.rglob("*"), key=lambda p: -len(p.parts)):
        if d.is_dir() and d.name in exclude_dirs:
            shutil.rmtree(d)


def collect_flat(root):
    """Upstream already ships one directory per skill."""
    out = {}
    for d in sorted(root.iterdir()):
        if d.is_dir() and (d / "SKILL.md").is_file():
            out[frontmatter_name(d / "SKILL.md") or d.name] = d
    return out, None, None


def collect_single(root):
    """Upstream repo root IS one skill (no per-skill subdirectory).

    Vendors only what SKILL.md's own "Supporting Resources" section links to
    -- its sibling *.md docs and examples/ -- not the CLI's own source (src/,
    server/), build config, or plugin manifest. Those are for building and
    publishing the npm package this skill documents, not for Claude reading it.
    """
    name = frontmatter_name(root / "SKILL.md")
    if not name:
        raise SystemExit(f"no name: frontmatter in {root}/SKILL.md")
    curated = root.parent / f"_single_{name}"
    if curated.exists():
        shutil.rmtree(curated)
    curated.mkdir()
    for md in root.glob("*.md"):
        shutil.copy2(md, curated / md.name)
    if (root / "examples").is_dir():
        shutil.copytree(root / "examples", curated / "examples")
    if (root / "LICENSE").is_file():
        shutil.copy2(root / "LICENSE", curated / "LICENSE")
    # Upstream's own SKILL.md links ./COMMAND_LINE_GUIDE.md, but the file it
    # means actually lives at examples/COMMAND_LINE_GUIDE.md.
    skill_md = curated / "SKILL.md"
    text = orig = skill_md.read_text(encoding="utf-8")
    text = text.replace("(./COMMAND_LINE_GUIDE.md)", "(./examples/COMMAND_LINE_GUIDE.md)")
    if text != orig:
        skill_md.write_text(text, encoding="utf-8")
    return {name: curated}, None, None


def collect_nested(root):
    """Upstream ships NN-category/<skill>/. Flatten by frontmatter name.

    The loader scans only the skills root's immediate children and requires
    <child>/SKILL.md, without recursing, so nesting would load nothing.
    """
    cats = [d for d in sorted(root.iterdir())
            if d.is_dir() and re.match(r'^\d+-', d.name)]
    out, bycat, dirmap = {}, {}, {}
    for c in cats:
        for sm in sorted(c.rglob("SKILL.md")):
            n = frontmatter_name(sm)
            if not n:
                continue
            if n in out:
                raise SystemExit(f"duplicate skill name upstream: {n}")
            out[n] = sm.parent
            dirmap[sm.parent.name] = n
            bycat.setdefault(c.name, []).append(n)
    return out, bycat, dirmap


COLLECTORS = {"flat": collect_flat, "nested": collect_nested, "single": collect_single}


def fix_routing(staged, bycat, dirmap):
    """Re-point links that flattening or upstream drift left dangling."""
    targets = list(staged.glob("*/SKILL.md")) + \
              list(staged.glob("*/references/skill-routing.md"))

    def sub_pair(m):
        d = m.group(2)
        if d in dirmap:
            return f"`{dirmap[d]}`"
        if d in ALIAS and ALIAS[d] in dirmap:
            return f"`{dirmap[ALIAS[d]]}`"
        if d in ABSENT:
            return "not in this library"
        return m.group(0)

    for t in targets:
        txt = orig = t.read_text(encoding="utf-8")
        txt = CAT_RE.sub(sub_pair, txt)
        txt = BARE_RE.sub(
            lambda m: "`" + "`, `".join(bycat[m.group(1)]) + "`"
            if m.group(1) in bycat else m.group(0), txt)
        for c, names in bycat.items():
            txt = txt.replace(f"invoke {c}/ skills",
                              "invoke `" + "`, `".join(names) + "` skills")
        if "slime" in dirmap:
            txt = txt.replace("../slime/references/",
                              f"../{dirmap['slime']}/references/")
        if txt != orig:
            t.write_text(txt, encoding="utf-8")


README = """# Claude Code skills

Vendored skill libraries, loaded automatically by every Claude Code session on
this repo. Claude picks the right skill from your request; you can also invoke
one by name (e.g. `/cro`, `/autoresearch`).

| Library | Skills | Source | Commit | License |
|---|---|---|---|---|
{rows}

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
"""


def build(workdir):
    """Clone both upstreams and stage the merged, flattened skill set."""
    staged = workdir / "staged"
    staged.mkdir(parents=True)
    upstreams, managed = {}, set()
    for key, lib in LIBS.items():
        src = workdir / f"upstream-{key}"
        head = clone(lib["url"], lib["pin"], src)
        root = src / lib["subdir"] if lib["subdir"] else src
        prune_excluded(root, lib["exclude_dirs"])
        collect = COLLECTORS[lib["layout"]]
        skills, bycat, dirmap = collect(root)
        if not skills:
            raise SystemExit(f"upstream {key} produced no skills — refusing to write")
        for name, path in sorted(skills.items()):
            if name in managed:
                raise SystemExit(f"skill name collides across libraries: {name}")
            shutil.copytree(path, staged / name)
            managed.add(name)
        if bycat:
            fix_routing(staged, bycat, dirmap)
        upstreams[key] = {"url": lib["url"], "commit": head, "skills": len(skills),
                          "license": lib["license"]}

    rows = "\n".join(
        f"| {k.capitalize()} | {v['skills']} | "
        f"[{v['url'].split('github.com/')[1]}]({v['url']}) | `{v['commit']}` | {v['license']} |"
        for k, v in upstreams.items())
    (staged / "README.md").write_text(README.format(rows=rows), encoding="utf-8")
    return staged, managed, upstreams


def read_manifest(sync_dir):
    p = sync_dir / MANIFEST
    if not p.is_file():
        return set()
    try:
        return set(json.loads(p.read_text(encoding="utf-8")).get("managed", []))
    except (ValueError, OSError):
        print(f"warning: {p} unreadable; pruning nothing this run", file=sys.stderr)
        return set()


def write_manifest(sync_dir, managed, upstreams):
    (sync_dir / MANIFEST).write_text(json.dumps({
        "_comment": "Written by sync_skills.py. Lists the skills it owns; only "
                    "these are ever deleted. Do not hand-edit.",
        "upstreams": upstreams,
        "managed": sorted(managed),
    }, indent=2) + "\n", encoding="utf-8")


def differs(a, b):
    return subprocess.run(["diff", "-rq", str(a), str(b)],
                          capture_output=True).returncode != 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo")
    ap.add_argument("--workdir")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--check", action="store_true",
                   help="report drift and exit 1; write nothing")
    g.add_argument("--rebuild", action="store_true",
                   help="delete every managed skill first, then re-vendor")
    a = ap.parse_args()

    repo = pathlib.Path(a.repo).resolve()
    dest = repo / ".claude" / "skills"
    sync_dir = repo / ".claude" / "skills-sync"

    tmp = pathlib.Path(a.workdir) if a.workdir else \
        pathlib.Path(tempfile.mkdtemp(prefix="skills-sync-"))
    tmp.mkdir(parents=True, exist_ok=True)

    staged, managed, upstreams = build(tmp)
    previously = read_manifest(sync_dir)
    orphans = sorted(previously - managed)

    if a.check:
        stale = [f"missing: {n}" for n in sorted(managed)
                 if not (dest / n).is_dir()]
        stale += [f"changed: {n}" for n in sorted(managed)
                  if (dest / n).is_dir() and differs(staged / n, dest / n)]
        stale += [f"orphaned (upstream dropped it): {n}" for n in orphans
                  if (dest / n).is_dir()]
        rd = dest / "README.md"
        if not rd.is_file() or rd.read_text(encoding="utf-8") != \
                (staged / "README.md").read_text(encoding="utf-8"):
            stale.append("changed: README.md")
        if previously != managed:
            stale.append("changed: manifest.json")
        for s in stale:
            print(s)
        print(f"{len(stale)} item(s) out of date" if stale else "up to date")
        return 1 if stale else 0

    dest.mkdir(parents=True, exist_ok=True)
    sync_dir.mkdir(parents=True, exist_ok=True)

    if a.rebuild:
        # Drop everything we own, then re-vendor from scratch. Skills we do not
        # own are left alone even here — this is a re-vendor, not a wipe.
        for n in sorted(previously | managed):
            if (dest / n).is_dir():
                shutil.rmtree(dest / n)
        print(f"rebuild: removed {len(previously | managed)} managed skill dirs")

    for n in sorted(managed):
        shutil.rmtree(dest / n, ignore_errors=True)
        shutil.copytree(staged / n, dest / n)
    shutil.copy2(staged / "README.md", dest / "README.md")

    for n in orphans:
        if (dest / n).is_dir():
            shutil.rmtree(dest / n)
            print(f"pruned (upstream dropped it): {n}")

    write_manifest(sync_dir, managed, upstreams)

    unmanaged = sorted(d.name for d in dest.iterdir()
                       if d.is_dir() and d.name not in managed
                       and (d / "SKILL.md").is_file())
    for n in unmanaged:
        print(f"note: not ours, left in place: {n}")
    print(f"synced {len(managed)} skills into {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
