#!/usr/bin/env python3
"""Build the offline terminal reference site from the og-aws source guide.

Reads the vendored copy of open-guides/og-aws (build/source/) and emits
data/content.js, a single JavaScript file holding every section of the guide
as pre-rendered HTML. Embedding the payload as JS (rather than JSON fetched at
runtime) is what lets the site work straight off the filesystem, with no
server and no network.

    python3 build/build.py
"""

from __future__ import annotations

import html
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "build" / "source"
OUT = ROOT / "data" / "content.js"

UPSTREAM = "https://github.com/open-guides/og-aws"

# Sections are grouped for the sidebar tree. Anything not listed here that
# looks like a service section falls through to "services".
GROUPS = [
    ("purpose", "purpose", ["Why an Open Guide?", "Scope", "Legend"]),
    (
        "general",
        "aws in general",
        [
            "General Information",
            "Learning and Career Development",
            "Managing AWS",
            "Managing Servers and Applications",
        ],
    ),
    ("services", "services", []),  # catch-all, filled in document order
    (
        "topics",
        "special topics",
        ["High Availability", "Billing and Cost Management", "Further Reading"],
    ),
    ("legal", "legal", ["Disclaimer", "License"]),
    ("meta", "meta", []),  # credits / contributing / colophon
]

# The legend of the guide, as machine-readable tags. Order matters: it is the
# order badges appear on a section header.
LEGEND = [
    ("docs", "\U0001f4d2", "official docs"),
    ("tip", "\U0001f539", "tip"),
    ("serious", "❗", "serious gotcha"),
    ("gotcha", "\U0001f538", "gotcha"),
    ("folklore", "\U0001f4dc", "undocumented"),
    ("new", "\U0001f425", "new/immature"),
    ("perf", "⏱", "performance"),
    ("lockin", "⛓", "lock-in"),
    ("alt", "\U0001f680", "non-AWS alternative"),
    ("cost", "\U0001f4b8", "cost"),
    ("cathedral", "\U0001f54d", "heavyweight solution"),
    ("todo", "\U0001f6a7", "needs work"),
]

# GitHub emoji shortcodes used in the source.
SHORTCODES = {
    ":arrow_up:": "↑",
    ":arrow_down:": "↓",
    ":warning:": "⚠",
}

EXTRA_PAGES = [
    ("credits", "Credits", "AUTHORS.md", "meta"),
    ("contributing", "Contributing", "CONTRIBUTING.md", "meta"),
]

# Links to sibling files in the upstream repo become internal routes.
FILE_ROUTES = {
    "AUTHORS.md": "#/credits",
    "CONTRIBUTING.md": "#/contributing",
    "LICENSE.txt": "#/license",
    "README.md": "#/",
}


def slugify(text: str) -> str:
    """Reproduce GitHub's heading anchor slugs so in-guide links resolve."""
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = text.lower().strip()
    # Drop everything that is not a word character, space or hyphen. This is
    # what strips the emoji, punctuation and the ∙ separators.
    out = []
    for ch in text:
        if ch in " -_":
            out.append("-" if ch == " " else ch)
        elif ch.isalnum() and unicodedata.category(ch)[0] in "LN":
            out.append(ch)
    return re.sub(r"-+", "-", "".join(out)).strip("-")


def strip_tags(fragment: str) -> str:
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", fragment, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def split_sections(md_text: str):
    """Split the guide on its setext H2 headings (``Title`` + ``-----``)."""
    lines = md_text.split("\n")
    sections = []
    current_title = None
    buffer: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        is_setext_h2 = (
            line.strip()
            # Setext underlines only need one dash; the S3 heading uses two.
            and re.fullmatch(r"-{2,}", nxt.strip())
            and not line.lstrip().startswith(("-", "*", "|", "+", ">"))
        )
        is_setext_h1 = line.strip() and re.fullmatch(r"={3,}", nxt.strip())
        if is_setext_h2:
            if current_title is not None:
                sections.append((current_title, "\n".join(buffer).strip()))
            current_title = line.strip()
            buffer = []
            i += 2
            continue
        if is_setext_h1:
            i += 2  # the document title; the site supplies its own
            continue
        if current_title is not None:
            buffer.append(line)
        i += 1
    if current_title is not None:
        sections.append((current_title, "\n".join(buffer).strip()))
    return sections


def make_converter() -> markdown.Markdown:
    return markdown.Markdown(
        extensions=["tables", "fenced_code", "sane_lists", "md_in_html", "nl2br"],
        extension_configs={"nl2br": {}},
    )


def expand_shortcodes(text: str) -> str:
    for code, char in SHORTCODES.items():
        text = text.replace(code, char)
    return text


BACK_TO_TOP = re.compile(
    r"<p>\s*<a href=\"#table-of-contents\">[^<]*</a>\s*</p>\s*", re.I
)
HEADING = re.compile(r"<h([1-6])>(.*?)</h\1>", re.S)
LINK = re.compile(r'<a href="([^"]*)"')
IMG = re.compile(r'<img([^>]*?)src="([^"]*)"([^>]*?)/?>')
ANCHOR_LINK = re.compile(r'<a class="anchor".*?</a>', re.S)
HEADING_BLOCK = re.compile(r"<h[1-6][^>]*>.*?</h[1-6]>", re.S)


NAMED_ANCHOR = re.compile(r'<a name="([^"]+)"')


def register_named_anchors(body: str, page_id: str, anchors: dict) -> str:
    """The guide hand-rolls a few ``<a name=...>`` footnote targets."""

    def repl(match):
        name = match.group(1)
        anchors.setdefault(name, (page_id, name))
        return f'<a id="{name}" name="{name}"'

    return NAMED_ANCHOR.sub(repl, body)


def add_heading_ids(body: str, page_id: str, seen: dict, anchors: dict):
    """Give every heading a GitHub-compatible id and record where it lives."""

    def repl(match):
        level, inner = match.group(1), match.group(2)
        base = slugify(inner)
        if not base:
            base = "section"
        count = seen.get(base, 0)
        seen[base] = count + 1
        slug = base if count == 0 else f"{base}-{count}"
        anchors.setdefault(slug, (page_id, slug))
        label = strip_tags(inner)
        return (
            f'<h{level} id="{slug}" class="sec-h sec-h{level}">'
            f'<a class="anchor" href="#/{page_id}#{slug}" '
            f'aria-label="link to {html.escape(label, quote=True)}">#</a>'
            f"{inner}</h{level}>"
        )

    return HEADING.sub(repl, body)


def rewrite_links(body: str, anchors: dict, page_id: str):
    """Point in-guide anchors at hash routes and mark outbound links."""

    def repl(match):
        href = match.group(1)
        if href.startswith("#"):
            slug = href[1:]
            if slug == "table-of-contents":
                return '<a href="#/" data-nav="1"'
            target = anchors.get(slug) or anchors.get(slugify(slug))
            if target:
                target_page, target_slug = target
                # A link to a section's own top-level slug is just the page.
                if target_slug == target_page:
                    return f'<a href="#/{target_page}" data-nav="1"'
                return f'<a href="#/{target_page}#{target_slug}" data-nav="1"'
            return f'<a href="#/{page_id}#{slug}" data-nav="1"'
        for name, route in FILE_ROUTES.items():
            if href == name or href.endswith("/" + name):
                return f'<a href="{route}" data-nav="1"'
        if href.startswith(("http://", "https://")):
            return f'<a href="{href}" target="_blank" rel="noopener noreferrer" class="ext"'
        return match.group(0)

    body = LINK.sub(repl, body)
    body = re.sub(
        r'(<a href="[^"]*" target="_blank" rel="noopener noreferrer" class="ext">)(.*?)</a>',
        lambda m: m.group(1) + m.group(2) + "</a>",
        body,
        flags=re.S,
    )
    return body


def rewrite_images(body: str) -> str:
    def repl(match):
        pre, src, post = match.groups()
        if src.startswith("figures/"):
            return f'<img{pre}src="{src}"{post} loading="lazy">'
        if src.startswith(("http://", "https://")):
            # Badge/shield images need the network; the site is offline-first,
            # so they are dropped rather than left as broken boxes.
            return ""
        return match.group(0)

    body = IMG.sub(repl, body)
    # An anchor whose only content was a remote image is now empty.
    body = re.sub(r'<a href="[^"]*"[^>]*>\s*</a>', "", body)
    body = re.sub(r"<p>\s*</p>", "", body)
    return body


def wrap_tables(body: str) -> str:
    return body.replace("<table>", '<div class="table-wrap"><table>').replace(
        "</table>", "</table></div>"
    )


def tag_counts(md_body: str) -> list:
    counts = []
    for key, emoji, label in LEGEND:
        n = md_body.count(emoji)
        if n:
            counts.append({"key": key, "emoji": emoji, "label": label, "count": n})
    return counts


def first_docs_link(md_body: str):
    match = re.search(r"\[Homepage\]\((https?://[^)]+)\)", md_body)
    return match.group(1) if match else None


def summarize(text: str, limit: int = 240) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    if " " in cut:
        cut = cut[: cut.rindex(" ")]
    return cut + "…"


def group_for(title: str) -> str:
    for gid, _label, titles in GROUPS:
        if title in titles:
            return gid
    return "services"


def source_info() -> dict:
    """Provenance of the vendored guide, recorded when it was pulled in."""
    path = SOURCE / "SOURCE.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"repo": "open-guides/og-aws", "short": "unknown", "date": "unknown"}


def build_section(title, md_body, page_id, seen, anchors, converter):
    md_body = expand_shortcodes(md_body)
    body = converter.reset().convert(md_body)
    body = BACK_TO_TOP.sub("", body)
    body = add_heading_ids(body, page_id, seen, anchors)
    body = register_named_anchors(body, page_id, anchors)
    body = rewrite_images(body)
    body = wrap_tables(body)
    # The "#" anchor links are chrome, not content: keep them out of search
    # text, and keep headings out of the one-line summary.
    text = strip_tags(ANCHOR_LINK.sub("", body))
    prose = strip_tags(HEADING_BLOCK.sub(" ", ANCHOR_LINK.sub("", body)))
    subs = [
        {"id": m.group(2), "title": strip_tags(m.group(3)), "level": int(m.group(1))}
        for m in re.finditer(
            r'<h([34]) id="([^"]+)"[^>]*>(.*?)</h\1>', body, flags=re.S
        )
    ]
    for sub in subs:
        sub["title"] = re.sub(r"^#\s*", "", sub["title"]).strip()
    return {
        "id": page_id,
        "title": title,
        "group": group_for(title),
        "html": body,
        "text": text,
        "words": len(text.split()),
        "subs": subs,
        "tags": tag_counts(md_body),
        "docs": first_docs_link(md_body),
        "summary": summarize(prose),
    }


def main() -> None:
    readme = (SOURCE / "README.md").read_text(encoding="utf-8")
    converter = make_converter()
    seen: dict[str, int] = {}
    anchors: dict[str, tuple[str, str]] = {}
    sections = []

    raw_sections = split_sections(readme)
    for title, md_body in raw_sections:
        if title.lower() == "table of contents":
            continue
        page_id = slugify(title)
        anchors[page_id] = (page_id, page_id)
        sections.append(
            build_section(title, md_body, page_id, seen, anchors, converter)
        )

    for page_id, title, filename, group in EXTRA_PAGES:
        raw = (SOURCE / filename).read_text(encoding="utf-8")
        # These files lead with their own title; the site renders its own.
        raw = re.sub(r"\A#+ .*\n", "", raw)
        raw = re.sub(r"\A(.+)\n[=-]{3,}\n", "", raw)
        anchors[page_id] = (page_id, page_id)
        section = build_section(title, raw, page_id, seen, anchors, converter)
        section["group"] = group
        sections.append(section)

    license_text = (SOURCE / "LICENSE.txt").read_text(encoding="utf-8")
    sections.append(
        {
            "id": "license-full",
            "title": "License (full text)",
            "group": "meta",
            "html": '<pre class="plain">' + html.escape(license_text) + "</pre>",
            "text": strip_tags(license_text),
            "words": len(license_text.split()),
            "subs": [],
            "tags": [],
            "docs": None,
            "summary": "Creative Commons Attribution 4.0 International, in full.",
        }
    )

    for section in sections:
        section["html"] = rewrite_links(section["html"], anchors, section["id"])

    word_count = sum(s["words"] for s in sections)
    # The plain-text body is only needed for search, and the client can strip
    # tags itself in a few milliseconds. Shipping it too would add ~300 KB.
    for section in sections:
        del section["text"]

    order = {s["id"]: i for i, s in enumerate(sections)}
    groups = []
    for gid, label, _titles in GROUPS:
        members = [s["id"] for s in sections if s["group"] == gid]
        members.sort(key=lambda sid: order[sid])
        if members:
            groups.append({"id": gid, "label": label, "sections": members})

    source = source_info()
    payload = {
        "meta": {
            "title": "The Open Guide to Amazon Web Services",
            "upstream": UPSTREAM,
            "license": "CC BY 4.0",
            "built": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "revision": source.get("short", "unknown"),
            "revisionFull": source.get("commit", ""),
            "sourceDate": source.get("date", ""),
            "sectionCount": len(sections),
            "wordCount": word_count,
            "legend": [
                {"key": k, "emoji": e, "label": l} for k, e, l in LEGEND
            ],
        },
        "groups": groups,
        "sections": sections,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(
        "/* Generated by build/build.py - do not edit by hand. */\n"
        "window.OGAWS = " + body + ";\n",
        encoding="utf-8",
    )
    size = OUT.stat().st_size / 1024
    print(
        f"wrote {OUT.relative_to(ROOT)}: {len(sections)} sections, "
        f"{payload['meta']['wordCount']:,} words, {size:.0f} KB"
    )


if __name__ == "__main__":
    main()
