# aws.manual

An offline, terminal-styled reference site built from
[The Open Guide to Amazon Web Services](https://github.com/open-guides/og-aws)
(`open-guides/og-aws`).

The whole guide — 65 sections, ~46,500 words, 50 AWS services — is compiled into a
single static page with a working command line and full-text search, fronted by a
landing page. Once the files are on disk it never touches the network: no CDN, no
analytics, no `fetch()`, and the fonts are vendored. Open `manual.html` from a USB
stick on a plane and everything still works.

```
╔═╗╦ ╦╔═╗ ╔╦╗╔═╗╔╗╔╦ ╦╔═╗╦
╠═╣║║║╚═╗ ║║║╠═╣║║║║ ║╠═╣║
╩ ╩╚╩╝╚═╝ ╩ ╩╩ ╩╝╚╝╚═╝╩ ╩╩═╝
```

## Run it

```sh
# straight off the filesystem — no server needed
xdg-open manual.html     # or: open manual.html (index.html is the landing page)
```

Serving it over HTTP also works and additionally registers a service worker, so the
site keeps working with the network unplugged and can be installed as a PWA:

```sh
python3 -m http.server 8000    # then visit http://localhost:8000
```

## The command line

The prompt at the bottom is the primary interface. `help` lists everything; the
frequently used ones:

| command | what it does |
| --- | --- |
| `ls [group]` | list sections, optionally one group |
| `tree` | the whole guide with subsections |
| `man s3`, `cd ec2`, or just `iam` | open a section (aliases and prefixes resolve) |
| `grep spot instance` | full-text search, ranked, with snippets |
| `tags gotcha` | every section carrying a legend mark, by count |
| `cat lambda` / `head lambda` | dump a section as text / just the summary |
| `star`, `stars`, `recent` | bookmarks and history |
| `theme lime`, `font +`, `crt on` | orange · lime · ice · synth · paper |
| `stats`, `neofetch`, `source` | corpus and provenance |

Keyboard: <kbd>ctrl+k</kbd> search · <kbd>/</kbd> filter the section list ·
<kbd>?</kbd> shortcuts · <kbd>[</kbd> <kbd>]</kbd> previous/next section ·
<kbd>tab</kbd> completion · <kbd>↑</kbd><kbd>↓</kbd> command history ·
<kbd>esc</kbd> closes things. Typing any other key jumps straight to the prompt.

Routes are hash-based (`manual.html#/s3`, `manual.html#/ec2#ec2-tips`), so every
section and subsection is linkable and the back button behaves. Older
`index.html#/…` links redirect to the manual.

## Design

The look is ported from [devvm.dev](https://devvm.dev/) and recoloured for AWS:
black background, AWS orange accent, squid-ink borders, pixel headings and
diagrams in Departure Mono, body text in Instrument Sans, code in Martian Mono.
The tokens, fonts and shared pieces (logo, buttons, tags) live in
`assets/css/theme.css`, and both pages follow the theme chosen in the manual. The
fonts are open source (SIL OFL) and vendored in `assets/fonts/`.

## How it is built

`build/source/` holds a vendored snapshot of the upstream guide (the 380 KB
`README.md`, `AUTHORS.md`, `CONTRIBUTING.md`, `LICENSE.txt`, plus `SOURCE.json`
recording the exact upstream commit). `build/build.py` turns it into
`data/content.js`:

- splits the guide on its setext `H2` headings into one page per section;
- renders Markdown to HTML (tables, nested lists, the guide's inline HTML);
- reproduces GitHub's heading slugs, so in-guide anchors like `#s3-tips` keep
  working — every one of them is rewritten to a local hash route;
- drops remote badge images and points figures at the local `figures/` copies;
- counts the legend marks (📒 🔹 ❗ 🔸 …) per section for the header badges;
- emits one `window.OGAWS = {…}` assignment — a plain `<script>` rather than a
  fetched JSON file, because `fetch()` is blocked under `file://`.

Rebuild after changing the source or the pipeline:

```sh
pip install markdown
python3 build/build.py
```

Search runs client-side: the payload ships HTML only, and the browser strips it to
plain text once, in the background, on first load (~640 KB payload instead of ~940 KB).

### Layout

```
index.html              landing page
manual.html             app shell
assets/css/theme.css    design tokens, themes, fonts, shared primitives
assets/css/landing.css  landing page
assets/css/terminal.css manual layout, print styles
assets/fonts/           vendored fonts (SIL OFL), see its README
assets/js/app.js        router, renderer, search, palette
assets/js/shell.js      command interpreter, completion, history
assets/js/boot.js       boot sequence, service-worker registration
data/content.js         generated payload (do not edit)
build/build.py          the generator
build/source/           vendored upstream snapshot
figures/                figures from the guide
sw.js                   cache-first worker for http-served copies
```

## Refreshing the content

```sh
git clone --depth 1 https://github.com/open-guides/og-aws /tmp/og-aws
cp /tmp/og-aws/{README.md,AUTHORS.md,CONTRIBUTING.md,LICENSE.txt} build/source/
git -C /tmp/og-aws log -1 --format='{"repo":"open-guides/og-aws","commit":"%H","short":"%h","date":"%ad","subject":"%s"}' --date=short > build/source/SOURCE.json
cp /tmp/og-aws/figures/*.png figures/
python3 build/build.py
```

Bump `CACHE` in `sw.js` when the payload changes, so served copies pick it up.

The Russian translation under `translations/` upstream is not included; only the
English guide is built.

## Licensing and attribution

The guide's text is © the og-aws contributors, licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — see `build/source/LICENSE.txt`
and the in-app `credits` and `license` pages. This repository reproduces it under
that license; the content is unmodified apart from formatting for the web.

The site code (build script, CSS, JS) is MIT licensed — see `LICENSE`. The fonts
in `assets/fonts/` are under the SIL Open Font License 1.1.

Not affiliated with, endorsed by, or sponsored by Amazon Web Services.
