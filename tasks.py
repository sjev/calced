# type: ignore
"""Automation tasks. Run `inv -l` for the list."""

import re
import shutil
from pathlib import Path
from tempfile import mkdtemp

import tomllib
from invoke import task

SITE_URL = "https://sjev.github.io/calced"


@task
def venv(c):
    """Sync dependencies."""
    c.run("uv sync")


@task
def test(c):
    """Run all tests."""
    c.run("node web/test.mjs")
    c.run("node web/test-suggest.mjs")
    c.run("node web/test-store.mjs")


def _version() -> str:
    return tomllib.loads(Path("pyproject.toml").read_text())["project"]["version"]


@task
def version(c):
    """Print the current version."""
    print(_version())


# (file, pattern, replacement) for every file that shows the version. `{v}` is the new one.
# pyproject.toml is the source of truth; the web app has no build step, so the string is
# written into it here.
VERSION_PATTERNS = [
    ("pyproject.toml", r'^version = ".*"$', 'version = "{v}"'),
    ("web/index.html", r'class="ver">v[\d.]*<', 'class="ver">v{v}<'),
]


@task(help={"part": "patch, minor or major"})
def bump(c, part):
    """Bump the version in every file and commit the change."""
    if part not in ("patch", "minor", "major"):
        raise SystemExit("Usage: inv bump <patch|minor|major>")

    if c.run("git status --porcelain", hide=True).stdout.strip():
        raise SystemExit("Working tree is dirty. Commit or stash changes first.")

    old = _version()
    major, minor, patch = (int(x) for x in old.split("."))
    if part == "major":
        major, minor, patch = major + 1, 0, 0
    elif part == "minor":
        minor, patch = minor + 1, 0
    else:
        patch += 1
    new = f"{major}.{minor}.{patch}"

    for name, pattern, replacement in VERSION_PATTERNS:
        path = Path(name)
        text = path.read_text()
        new_text, count = re.subn(pattern, replacement.format(v=new), text, flags=re.MULTILINE)
        if count == 0:
            raise SystemExit(f"Error: no match for {pattern!r} in {name}")
        path.write_text(new_text)

    files = " ".join(name for name, _, _ in VERSION_PATTERNS)
    c.run(f'git commit -m "Bump version: {old} -> {new}" {files}')
    print(f"Bumped {old} -> {new}")


REDIRECT_HTML = """<!DOCTYPE html>
<html>
<head>
<meta http-equiv="refresh" content="0;url=./{major}/">
<meta property="og:title" content="calced">
<meta property="og:description" content="A notepad calculator that evaluates math \
expressions in plain text. No install, works offline.">
<meta property="og:type" content="website">
<meta property="og:image" content="{site}/og.png">
<meta property="og:url" content="{site}">
</head>
<body></body>
</html>
"""


@task
def deploy_web(c):
    """Publish the web/ directory to the gh-pages branch."""
    version = _version()
    major = version.split(".")[0]
    print(f"Deploying web app v{version} (major={major})")

    tmp = mkdtemp()
    try:
        if c.run("git show-ref --verify --quiet refs/remotes/origin/gh-pages", warn=True).ok:
            c.run(f"git worktree add {tmp} gh-pages")
            c.run(f"git -C {tmp} reset --hard origin/gh-pages")
        else:
            c.run(f"git worktree add --orphan -b gh-pages {tmp}")

        # copytree, so that new modules ship without touching a list here
        shutil.copytree(
            "web",
            Path(tmp, major),
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns("test*.mjs", "package.json", "og.png"),
        )
        shutil.copy("web/og.png", Path(tmp, "og.png"))
        Path(tmp, "index.html").write_text(REDIRECT_HTML.format(major=major, site=SITE_URL))
        Path(tmp, ".nojekyll").touch()

        c.run(f"git -C {tmp} add -A")
        c.run(f'git -C {tmp} commit -m "Deploy web app v{version}"')
        c.run(f"git -C {tmp} push origin gh-pages")
    finally:
        c.run(f"git worktree remove --force {tmp}", warn=True, hide=True)
        shutil.rmtree(tmp, ignore_errors=True)


@task
def release(c):
    """Test and publish the current version. Use `inv bump` first."""
    test(c)
    if c.run("git status --porcelain", hide=True).stdout.strip():
        raise SystemExit("Error: working directory is dirty. Commit changes first.")

    print(f"Releasing v{_version()}...")
    deploy_web(c)
    c.run("git push origin master")
    print(f"Released v{_version()}")
