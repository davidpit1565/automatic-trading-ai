#!/usr/bin/env python3
"""Rebuild a repo's .claude/skills/ from the upstream skill libraries.

Idempotent: run it against any repo checkout and .claude/skills/ ends up
matching the pinned upstream versions. Safe to re-run; it only rewrites the
skills it manages and leaves any other skill directory alone.

    python3 sync_skills.py /path/to/repo [--workdir DIR] [--check]

--check exits 1 if the repo is out of date, without writing anything.
"""
import argparse, os, re, shutil, subprocess, sys, tempfile, pathlib

# Upstream libraries. Pin a commit to freeze; None tracks the default branch.
LIBS = {
    "marketing": {
        "url": "https://github.com/coreyhaines31/marketingskills",
        "pin": None, "subdir": "skills", "layout": "flat",
        "exclude_dirs": {"evals"},
    },
    "research": {
        "url": "https://github.com/orchestra-research/ai-research-skills",
        "pin": None, "subdir": "", "layout": "nested",
        "exclude_dirs": set(),
    },
}

# Rows in the research library's routing table that name skills it does not ship.
ABSENT = {"torchtune", "inspect-ai", "quanto", "smolagents", "claude-agent-sdk",
          "milvus", "qwen2-vl", "pixtral", "florence-2", "colpali"}
# ...and rows that use a name variant of a skill it does ship.
ALIAS = {"hf-tokenizers": "huggingface-tokenizers", "trl": "trl-fine-tuning",
         "transformerlens": "transformer-lens", "fsdp": "pytorch-fsdp2",
         "lm-eval-harness": "lm-evaluation-harness", "wandb": "weights-and-biases"}

CAT_RE  = re.compile(r'`?((?:0-autoresearch-skill|\d\d-[a-z][a-z0-9-]*))/([a-z0-9][a-z0-9._-]*)/?`?')
BARE_RE = re.compile(r'`(\d\d-[a-z][a-z0-9-]*)/`')


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


def prune(tree, exclude_dirs):
    if not exclude_dirs:
        return
    for d in sorted(tree.rglob("*"), key=lambda p: -len(p.parts)):
        if d.is_dir() and d.name in exclude_dirs:
            shutil.rmtree(d)


def collect_flat(root, exclude_dirs):
    """Upstream already ships one directory per skill."""
    out = {}
    for d in sorted(root.iterdir()):
        if d.is_dir() and (d / "SKILL.md").is_file():
            out[frontmatter_name(d / "SKILL.md") or d.name] = d
    return out


def collect_nested(root, exclude_dirs):
    """Upstream ships NN-category/<skill>/. Flatten by frontmatter name.

    Claude Code's loader scans only the immediate children of the skills root
    and requires <child>/SKILL.md, without recursing, so nesting loads nothing.
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


def fix_routing(staged, bycat, dirmap):
    """Re-point links that flattening or upstream drift left dangling."""
    targets = list(staged.glob("*/SKILL.md")) + \
              list(staged.glob("*/references/skill-routing.md"))

    def sub_pair(m):
        cat, d = m.group(1), m.group(2)
        if d in dirmap:                 return f"`{dirmap[d]}`"
        if d in ALIAS and ALIAS[d] in dirmap:
            return f"`{dirmap[ALIAS[d]]}`"
        if d in ABSENT:                 return "not in this library"
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
            txt = txt.replace("../slime/references/", f"../{dirmap['slime']}/references/")
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

## Do not hand-edit

This directory is generated. Edits are overwritten on the next sync. The
generator lives at `.claude/skills-sync/sync_skills.py`:

```bash
python3 .claude/skills-sync/sync_skills.py .          # rewrite in place
python3 .claude/skills-sync/sync_skills.py . --check   # exit 1 if out of date
```
"""


def build(workdir):
    """Clone both upstreams and stage the merged, flattened skill set."""
    staged = workdir / "staged"
    staged.mkdir(parents=True)
    heads, managed = {}, set()
    for key, lib in LIBS.items():
        src = workdir / f"upstream-{key}"
        heads[key] = clone(lib["url"], lib["pin"], src)
        root = src / lib["subdir"] if lib["subdir"] else src
        prune(root, lib["exclude_dirs"])
        if lib["layout"] == "flat":
            skills = collect_flat(root, lib["exclude_dirs"])
            bycat = dirmap = None
        else:
            skills, bycat, dirmap = collect_nested(root, lib["exclude_dirs"])
        for name, path in skills.items():
            if name in managed:
                raise SystemExit(f"skill name collides across libraries: {name}")
            shutil.copytree(path, staged / name)
            managed.add(name)
        if bycat:
            fix_routing(staged, bycat, dirmap)
        heads[key] = (heads[key], len(skills))

    rows = "\n".join(
        f"| {k.capitalize()} | {n} | [{LIBS[k]['url'].split('github.com/')[1]}]"
        f"({LIBS[k]['url']}) | `{h}` | MIT |"
        for k, (h, n) in heads.items())
    (staged / "README.md").write_text(README.format(rows=rows), encoding="utf-8")
    return staged, managed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo")
    ap.add_argument("--workdir")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()

    dest = pathlib.Path(a.repo).resolve() / ".claude" / "skills"
    tmp = pathlib.Path(a.workdir) if a.workdir else \
        pathlib.Path(tempfile.mkdtemp(prefix="skills-sync-"))
    if tmp.exists() and not a.workdir:
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True, exist_ok=True)

    staged, managed = build(tmp)

    if a.check:
        stale = []
        for name in sorted(managed):
            cur = dest / name
            if not cur.is_dir():
                stale.append(f"missing: {name}")
            elif subprocess.run(["diff", "-rq", str(staged / name), str(cur)],
                                capture_output=True).returncode:
                stale.append(f"changed: {name}")
        rd = dest / "README.md"
        if not rd.is_file() or rd.read_text(encoding="utf-8") != \
                (staged / "README.md").read_text(encoding="utf-8"):
            stale.append("changed: README.md")
        for s in stale:
            print(s)
        print(f"{len(stale)} item(s) out of date" if stale else "up to date")
        return 1 if stale else 0

    dest.mkdir(parents=True, exist_ok=True)
    for name in managed:
        shutil.rmtree(dest / name, ignore_errors=True)
        shutil.copytree(staged / name, dest / name)
    shutil.copy2(staged / "README.md", dest / "README.md")
    # anything else with a SKILL.md is not ours; report it, never delete it
    for d in sorted(dest.iterdir()):
        if d.is_dir() and d.name not in managed and (d / "SKILL.md").is_file():
            print(f"note: leaving unmanaged skill in place: {d.name}")
    print(f"synced {len(managed)} skills into {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
