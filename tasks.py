# type: ignore
"""Automation tasks. Run `inv -l` for the list."""

import glob
import re
import shutil
from pathlib import Path
from tempfile import mkdtemp

import tomllib
from invoke import task

SOURCES = "python tests tasks.py"
SITE_URL = "https://sjev.github.io/calced"
REPO_URL = "https://github.com/sjev/calced"


@task
def venv(c):
    """Sync dependencies."""
    c.run("uv sync")


@task
def format(c):
    """Format code."""
    c.run(f"uv run ruff format {SOURCES}")


@task
def lint(c):
    """Run linters."""
    c.run(f"uv run ruff check {SOURCES}")
    c.run(f"uv run ruff format --check {SOURCES}")


@task
def test_py(c):
    """Run the Python unit tests and the .md integration tests."""
    c.run("uv run python -m unittest discover -s tests")
    for path in sorted(glob.glob("tests/*.md")):
        c.run(f"uv run python python/calced.py {path}")
    c.run("git diff --exit-code -- tests/*.md")  # the fixtures must not change


@task
def test_js(c):
    """Run the JavaScript tests."""
    c.run("node web/test.mjs")
    c.run("node web/test-suggest.mjs")
    c.run("node web/test-store.mjs")


@task
def test(c):
    """Run all tests (Python + JS)."""
    test_py(c)
    test_js(c)


@task
def test_diff(c):
    """Run generated cases through both engines; any difference fails."""
    c.run("uv run python -m unittest tests.test_differential -v", env={"CALCED_FUZZ_N": "3000"})


@task
def test_property(c):
    """Run the property-based tests."""
    c.run("uv run pytest tests/test_properties.py -v")


@task
def ci(c):
    """Run lint and tests."""
    lint(c)
    test(c)
    print("All checks passed!")


@task
def readme(c):
    """Regenerate README.md from its inline examples."""
    c.run("uv run cog -r README.md")


# (file, pattern, replacement). The pattern must match whatever value is there now,
# so a later URL change needs an edit here only.
URL_PATTERNS = [
    ("python/calced.py", r'^SITE_URL = ".*"$', f'SITE_URL = "{SITE_URL}"'),
    ("python/calced.py", r'^REPO_URL = ".*"$', f'REPO_URL = "{REPO_URL}"'),
    ("pyproject.toml", r'^Homepage = ".*"$', f'Homepage = "{SITE_URL}"'),
    ("pyproject.toml", r'^Repository = ".*"$', f'Repository = "{REPO_URL}"'),
    ("pyproject.toml", r'^Issues = ".*"$', f'Issues = "{REPO_URL}/issues"'),
    ("web/index.html", r'"og:image" content=".*"', f'"og:image" content="{SITE_URL}/og.png"'),
    ("web/index.html", r'"og:url" content=".*"', f'"og:url" content="{SITE_URL}"'),
    ("web/index.html", r'href="[^"]*#features"', f'href="{REPO_URL}#features"'),
    ("README.md", r"\[Open the web app\]\(.*\)", f"[Open the web app]({SITE_URL})"),
]


@task
def sync_urls(c):
    """Write SITE_URL and REPO_URL into every file that shows them."""
    for name, pattern, replacement in URL_PATTERNS:
        path = Path(name)
        text = path.read_text()
        new_text, count = re.subn(pattern, replacement, text, flags=re.MULTILINE)
        if count == 0:
            raise SystemExit(f"Error: no match for {pattern!r} in {name}")
        if new_text != text:
            path.write_text(new_text)
            print(f"updated {name}")
    readme(c)  # the "Try in web app" links come from `calced.py --url`


@task
def build(c):
    """Build the Python distribution."""
    c.run("uv build")


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


@task(pre=[build])
def release_python(c):
    """Publish the built distribution to PyPI."""
    c.run("uv publish dist/*")


@task
def release(c):
    """Test and publish the current version. Use `inv bump` first."""
    test(c)
    readme(c)
    if c.run("git status --porcelain", hide=True).stdout.strip():
        raise SystemExit("Error: working directory is dirty. Commit changes first.")

    print(f"Releasing v{_version()}...")
    release_python(c)
    deploy_web(c)
    c.run("git push origin master")
    print(f"Released v{_version()}")
