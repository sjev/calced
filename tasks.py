# type: ignore
"""Automation tasks. Run `inv -l` for the list."""

import glob
import shutil
from pathlib import Path
from tempfile import mkdtemp

import tomllib
from invoke import task

SOURCES = "python tests tasks.py"
SITE_URL = "https://calced.karl.berlin"


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


@task
def build(c):
    """Build the Python distribution."""
    c.run("uv build")


def _version() -> str:
    return tomllib.loads(Path("pyproject.toml").read_text())["project"]["version"]


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
    """Publish web/index.html to the gh-pages branch."""
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

        Path(tmp, major).mkdir(exist_ok=True)
        shutil.copy("web/index.html", Path(tmp, major, "index.html"))
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
    """Test, tag and publish a new release."""
    test(c)
    readme(c)
    if c.run("git status --porcelain", hide=True).stdout.strip():
        raise SystemExit("Error: working directory is dirty. Commit changes first.")

    tag = f"v{_version()}"
    if c.run(f"git rev-parse {tag}", hide=True, warn=True).ok:
        raise SystemExit(f"Error: tag {tag} already exists. Bump version in pyproject.toml.")

    print(f"Releasing {tag}...")
    c.run(f"git tag {tag}")
    release_python(c)
    deploy_web(c)
    c.run(f"git push origin master {tag}")
    print(f"Released {tag}")
