/* aws.manual — router, renderer, search. Everything runs offline from disk. */

(function () {
  "use strict";

  var DATA = window.OGAWS;
  if (!DATA) {
    document.body.innerHTML =
      '<pre style="padding:2rem">data/content.js failed to load.\n' +
      "Run: python3 build/build.py</pre>";
    return;
  }

  var SECTIONS = DATA.sections;
  var GROUPS = DATA.groups;
  var META = DATA.meta;
  var BY_ID = Object.create(null);
  var ORDER = [];
  var i;

  for (i = 0; i < SECTIONS.length; i++) BY_ID[SECTIONS[i].id] = SECTIONS[i];
  for (i = 0; i < GROUPS.length; i++) ORDER = ORDER.concat(GROUPS[i].sections);

  var GROUP_LABEL = Object.create(null);
  for (i = 0; i < GROUPS.length; i++) GROUP_LABEL[GROUPS[i].id] = GROUPS[i].label;

  var THEMES = ["phosphor", "amber", "ice", "synth", "paper"];
  var KEY = "aws.manual:";

  /* ---------- tiny helpers ---------- */

  var $ = function (sel) { return document.querySelector(sel); };
  var el = function (tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  function store(key, fallback) {
    try {
      var raw = localStorage.getItem(KEY + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(KEY + key, JSON.stringify(value));
    } catch (e) {
      /* private mode, file:// restrictions — preferences just won't persist */
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function escapeRe(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  var stripper = document.createElement("div");
  function stripTags(htmlStr) {
    stripper.innerHTML = htmlStr;
    var anchors = stripper.querySelectorAll("a.anchor");
    for (var k = 0; k < anchors.length; k++) anchors[k].remove();
    var text = stripper.textContent || "";
    stripper.textContent = "";
    return text.replace(/\s+/g, " ").trim();
  }

  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  /* ---------- search ---------- */

  var INDEX = null;

  function buildIndex() {
    if (INDEX) return INDEX;
    INDEX = SECTIONS.map(function (s) {
      var text = stripTags(s.html);
      return {
        id: s.id,
        title: s.title,
        text: text,
        lower: text.toLowerCase(),
        titleLower: s.title.toLowerCase()
      };
    });
    return INDEX;
  }

  function countOccurrences(haystack, needle) {
    var n = 0, from = 0, at;
    while ((at = haystack.indexOf(needle, from)) !== -1) { n++; from = at + needle.length; }
    return n;
  }

  /**
   * Rank sections against a whitespace-separated query. Every term must be
   * present somewhere in the section (AND), and title hits outrank body hits.
   */
  function search(query, limit) {
    var terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    var idx = buildIndex();
    var results = [];

    for (var s = 0; s < idx.length; s++) {
      var entry = idx[s], score = 0, ok = true, hits = 0;
      for (var t = 0; t < terms.length; t++) {
        var term = terms[t];
        var inBody = countOccurrences(entry.lower, term);
        var inTitle = countOccurrences(entry.titleLower, term);
        if (!inBody && !inTitle) { ok = false; break; }
        hits += inBody;
        score += Math.min(inBody, 40) + inTitle * 60;
        if (entry.titleLower === term) score += 300;
        if (entry.titleLower.indexOf(term) === 0) score += 80;
        if (new RegExp("\\b" + escapeRe(term)).test(entry.lower)) score += 8;
      }
      if (!ok) continue;
      results.push({
        id: entry.id,
        title: entry.title,
        score: score,
        hits: hits,
        snippet: snippetFor(entry.text, terms)
      });
    }

    results.sort(function (a, b) { return b.score - a.score || a.title.localeCompare(b.title); });
    return limit ? results.slice(0, limit) : results;
  }

  function snippetFor(text, terms) {
    var lower = text.toLowerCase(), at = -1, i;
    for (i = 0; i < terms.length && at === -1; i++) at = lower.indexOf(terms[i]);
    if (at === -1) at = 0;
    var start = Math.max(0, at - 70);
    var raw = text.slice(start, start + 200);
    if (start > 0) raw = "…" + raw;
    return raw;
  }

  function markTerms(plainText, terms) {
    var out = escapeHtml(plainText);
    for (var i = 0; i < terms.length; i++) {
      if (!terms[i]) continue;
      out = out.replace(new RegExp("(" + escapeRe(escapeHtml(terms[i])) + ")", "gi"), "<mark>$1</mark>");
    }
    return out;
  }

  /* ---------- state ---------- */

  var state = {
    page: "",
    anchor: "",
    terms: [],
    stars: store("stars", []),
    recents: store("recents", []),
    theme: store("theme", "phosphor"),
    crt: store("crt", "on"),
    fontSize: store("font", 14)
  };

  function isStarred(id) { return state.stars.indexOf(id) !== -1; }

  function toggleStar(id) {
    var at = state.stars.indexOf(id);
    if (at === -1) state.stars.push(id); else state.stars.splice(at, 1);
    save("stars", state.stars);
    renderTree();
    if (state.page === id) renderRoute();
    return at === -1;
  }

  function pushRecent(id) {
    state.recents = [id].concat(state.recents.filter(function (x) { return x !== id; })).slice(0, 10);
    save("recents", state.recents);
  }

  /* ---------- theme / display ---------- */

  function setTheme(name) {
    if (THEMES.indexOf(name) === -1) return false;
    state.theme = name;
    document.documentElement.setAttribute("data-theme", name);
    $("#theme-name").textContent = name;
    save("theme", name);
    return true;
  }

  function cycleTheme() {
    setTheme(THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length]);
    return state.theme;
  }

  function setCrt(on) {
    state.crt = on ? "on" : "off";
    document.documentElement.setAttribute("data-crt", state.crt);
    save("crt", state.crt);
    return state.crt;
  }

  function setFontSize(px) {
    state.fontSize = Math.max(10, Math.min(22, px));
    document.body.style.setProperty("--fs", state.fontSize + "px");
    save("font", state.fontSize);
    return state.fontSize;
  }

  /* ---------- sidebar ---------- */

  var treeEl, filterEl;

  function renderTree(filter) {
    var query = (filter || "").trim().toLowerCase();
    treeEl.textContent = "";

    GROUPS.forEach(function (group) {
      var ids = group.sections.filter(function (id) {
        if (!query) return true;
        var sec = BY_ID[id];
        return sec.title.toLowerCase().indexOf(query) !== -1 || id.indexOf(query) !== -1;
      });
      if (!ids.length) return;

      var box = el("div", "tree-group");
      box.appendChild(el("h3", null, group.label));

      ids.forEach(function (id) {
        var sec = BY_ID[id];
        var link = el("a", "tree-item", sec.title);
        link.href = "#/" + id;
        link.dataset.nav = "1";
        link.dataset.id = id;
        if (isStarred(id)) link.classList.add("starred");
        if (id === state.page) {
          link.classList.add("active");
          box.appendChild(link);
          if (sec.subs.length) box.appendChild(subList(sec));
          return;
        }
        box.appendChild(link);
      });

      treeEl.appendChild(box);
    });

    if (!treeEl.children.length) {
      treeEl.appendChild(el("p", "palette-empty", "no section matches “" + query + "”"));
    }
  }

  function subList(sec) {
    var list = el("ul", "tree-subs");
    sec.subs.forEach(function (sub) {
      if (sub.level > 3) return;
      var item = document.createElement("li");
      var link = el("a", null, sub.title);
      link.href = "#/" + sec.id + "#" + sub.id;
      link.dataset.nav = "1";
      link.dataset.sub = sub.id;
      item.appendChild(link);
      list.appendChild(item);
    });
    return list;
  }

  /* ---------- rendering ---------- */

  var docEl, footEl, viewportEl, crumbsEl;

  var BANNER = [
    "╔═╗╦ ╦╔═╗ ╔╦╗╔═╗╔╗╔╦ ╦╔═╗╦  ",
    "╠═╣║║║╚═╗ ║║║╠═╣║║║║ ║╠═╣║  ",
    "╩ ╩╚╩╝╚═╝ ╩ ╩╩ ╩╝╚╝╚═╝╩ ╩╩═╝"
  ].join("\n");

  function renderHome() {
    document.title = "aws.manual — offline terminal reference for AWS";
    crumbsEl.innerHTML = '<span class="sep">~</span> index';
    footEl.textContent = "";

    var serviceIds = (GROUPS.filter(function (g) { return g.id === "services"; })[0] || {}).sections || [];
    var html = [];

    html.push('<pre class="banner" aria-label="aws.manual">' + escapeHtml(BANNER) + "</pre>");
    html.push(
      '<p class="home-lede">' +
      "<b>The Open Guide to Amazon Web Services</b>, rebuilt as a terminal you can read on a plane. " +
      META.sectionCount + " sections · " + META.wordCount.toLocaleString() + " words · " +
      "zero network calls after load." +
      "</p>"
    );

    html.push('<div class="panel-grid">');

    html.push(
      '<div class="panel"><h2>start here</h2><ul>' +
      '<li><a href="#/why-an-open-guide" data-nav="1">why an open guide</a> — what this is and is not</li>' +
      '<li><a href="#/legend" data-nav="1">legend</a> — what the 📒 🔹 🔸 ❗ marks mean</li>' +
      '<li><a href="#/general-information" data-nav="1">general information</a> — service matrix, maturity, pricing</li>' +
      '<li><a href="#/security-and-iam" data-nav="1">security and iam</a> — read before you build</li>' +
      '<li><a href="#/billing-and-cost-management" data-nav="1">billing</a> — how the bill gets away from you</li>' +
      "</ul></div>"
    );

    html.push(
      '<div class="panel"><h2>shell</h2><ul>' +
      "<li><code>ls</code> — list every section</li>" +
      "<li><code>man s3</code> — open a section</li>" +
      "<li><code>grep spot instance</code> — full-text search</li>" +
      "<li><code>tags gotcha</code> — sections by legend mark</li>" +
      "<li><code>theme amber</code> · <code>crt off</code> — looks</li>" +
      "<li><code>help</code> — the rest</li>" +
      "</ul></div>"
    );

    var legendItems = META.legend.map(function (t) {
      return '<li><span class="em">' + t.emoji + "</span><span>" + escapeHtml(t.label) + "</span></li>";
    }).join("");
    html.push('<div class="panel"><h2>legend</h2><ul class="legend-list">' + legendItems + "</ul></div>");

    html.push(
      '<div class="panel"><h2>build</h2><ul>' +
      '<li class="kv"><span>source</span><span>og-aws @ ' + escapeHtml(META.revision) + "</span></li>" +
      '<li class="kv"><span>generated</span><span>' + escapeHtml(META.built) + "</span></li>" +
      '<li class="kv"><span>sections</span><span>' + META.sectionCount + "</span></li>" +
      '<li class="kv"><span>words</span><span>' + META.wordCount.toLocaleString() + "</span></li>" +
      '<li class="kv"><span>license</span><span><a href="#/license" data-nav="1">' + escapeHtml(META.license) + "</a></span></li>" +
      "</ul></div>"
    );

    html.push(
      '<div class="panel"><h2>figures &amp; tables</h2>' +
      '<div class="thumb-row">' +
      '<a href="#/general-information#tools-and-services-market-landscape" data-nav="1">' +
      '<img src="figures/aws-market-landscape-320px.png" alt="Tools and services market landscape" loading="lazy">' +
      "<span>tools &amp; services landscape</span></a>" +
      '<a href="#/billing-and-cost-management#aws-data-transfer-costs" data-nav="1">' +
      '<img src="figures/aws-data-transfer-costs-320px.png" alt="AWS data transfer costs" loading="lazy">' +
      "<span>data transfer costs</span></a>" +
      "</div><ul>" +
      '<li><a href="#/general-information#service-matrix" data-nav="1">service matrix</a> — AWS vs the alternatives</li>' +
      '<li><a href="#/general-information#aws-product-maturity-and-releases" data-nav="1">product maturity</a> — release dates</li>' +
      '<li><a href="#/s3#storage-durability-availability-and-price" data-nav="1">storage durability</a> — S3 vs EBS vs Glacier</li>' +
      "</ul></div>"
    );

    if (state.stars.length) {
      html.push('<div class="panel"><h2>starred</h2><div class="chip-row">' + chips(state.stars) + "</div></div>");
    }
    if (state.recents.length) {
      html.push('<div class="panel"><h2>recent</h2><div class="chip-row">' + chips(state.recents) + "</div></div>");
    }

    html.push("</div>");

    html.push('<h3 class="sec-h">services · ' + serviceIds.length + "</h3>");
    html.push('<div class="chip-row">' + chips(serviceIds) + "</div>");

    GROUPS.forEach(function (group) {
      if (group.id === "services") return;
      html.push('<h3 class="sec-h">' + escapeHtml(group.label) + "</h3>");
      html.push('<div class="chip-row">' + chips(group.sections) + "</div>");
    });

    html.push(
      '<p class="home-lede" style="margin-top:24px">Content by the ' +
      '<a href="#/credits" data-nav="1">og-aws contributors</a>, licensed ' +
      '<a href="#/license" data-nav="1">CC BY 4.0</a>. This offline build is unaffiliated with Amazon. ' +
      'Upstream: <a href="' + META.upstream + '" target="_blank" rel="noopener noreferrer" class="ext">open-guides/og-aws</a>.</p>'
    );

    docEl.innerHTML = html.join("\n");
  }

  function chips(ids) {
    return ids.map(function (id) {
      var sec = BY_ID[id];
      if (!sec) return "";
      return '<a class="chip" href="#/' + id + '" data-nav="1">' + escapeHtml(sec.title) + "</a>";
    }).join("");
  }

  function renderSection(sec) {
    document.title = sec.title + " — aws.manual";

    var badges = sec.tags.map(function (t) {
      return '<span class="badge" title="' + escapeHtml(t.label) + '">' + t.emoji + " <b>" + t.count + "</b></span>";
    }).join("");

    var actions = [];
    actions.push(
      '<button class="topbar-btn" data-action="star">' +
      (isStarred(sec.id) ? "★ starred" : "☆ star") + "</button>"
    );
    if (sec.docs) {
      actions.push('<a class="topbar-btn" href="' + sec.docs + '" target="_blank" rel="noopener noreferrer">aws docs ↗</a>');
    }
    actions.push(
      '<a class="topbar-btn" href="' + META.upstream + '#' + sec.id +
      '" target="_blank" rel="noopener noreferrer">upstream ↗</a>'
    );

    var head =
      '<header class="sec-head">' +
      '<div class="kicker">' + escapeHtml(GROUP_LABEL[sec.group] || sec.group) + " · " +
      plural(sec.words, "word") + "</div>" +
      "<h1>" + escapeHtml(sec.title) + "</h1>" +
      '<div class="sec-actions">' + actions.join("") + "</div>" +
      (badges ? '<div class="badges">' + badges + "</div>" : "") +
      "</header>";

    docEl.innerHTML = head + sec.html;

    var pos = ORDER.indexOf(sec.id);
    var prev = pos > 0 ? BY_ID[ORDER[pos - 1]] : null;
    var next = pos > -1 && pos < ORDER.length - 1 ? BY_ID[ORDER[pos + 1]] : null;
    footEl.innerHTML =
      (prev ? '<a href="#/' + prev.id + '" data-nav="1">← ' + escapeHtml(prev.title) + "</a>" : "<span></span>") +
      (next ? '<a href="#/' + next.id + '" data-nav="1">' + escapeHtml(next.title) + " →</a>" : "<span></span>");

    crumbsEl.innerHTML =
      '<a href="#/" data-nav="1">~</a><span class="sep">/</span>' +
      escapeHtml(GROUP_LABEL[sec.group] || sec.group) +
      '<span class="sep">/</span><span>' + escapeHtml(sec.title) + "</span>";

    pushRecent(sec.id);
  }

  function renderNotFound(page) {
    document.title = "not found — aws.manual";
    crumbsEl.innerHTML = '<a href="#/" data-nav="1">~</a><span class="sep">/</span>404';
    footEl.textContent = "";
    var near = search(page.replace(/-/g, " "), 6);
    docEl.innerHTML =
      "<h1>no such section: " + escapeHtml(page) + "</h1>" +
      "<p>cat: " + escapeHtml(page) + ": No such file or directory</p>" +
      (near.length
        ? "<p>did you mean:</p><div class=\"chip-row\">" + chips(near.map(function (r) { return r.id; })) + "</div>"
        : '<p><a href="#/" data-nav="1">back to index</a></p>');
  }

  /* ---------- routing ---------- */

  function parseHash() {
    var hash = location.hash || "";
    if (hash.indexOf("#/") !== 0) return { page: "", anchor: "" };
    var rest = hash.slice(2);
    var at = rest.indexOf("#");
    if (at === -1) return { page: rest, anchor: "" };
    return { page: rest.slice(0, at), anchor: rest.slice(at + 1) };
  }

  function renderRoute() {
    var route = parseHash();
    state.page = route.page;
    state.anchor = route.anchor;

    if (!route.page) {
      renderHome();
    } else if (BY_ID[route.page]) {
      renderSection(BY_ID[route.page]);
    } else {
      renderNotFound(route.page);
    }

    if (state.terms.length) highlightInDoc(state.terms);
    renderTree(filterEl.value);
    updatePrompt();
    document.body.classList.remove("nav-open");
    $("#menu-btn").setAttribute("aria-expanded", "false");

    if (route.anchor) {
      var target = document.getElementById(route.anchor);
      if (target) {
        // Positioned by hand rather than scrollIntoView: the viewport scrolls
        // smoothly, and a follow-up scrollTop write would cancel the animation.
        var delta = target.getBoundingClientRect().top - viewportEl.getBoundingClientRect().top;
        viewportEl.scrollTop = Math.max(0, viewportEl.scrollTop + delta - 12);
        flash(target);
        markActiveSub(route.anchor);
        return;
      }
    }
    if (state.terms.length) {
      var firstMark = docEl.querySelector("mark");
      if (firstMark) { firstMark.scrollIntoView({ block: "center" }); return; }
    }
    viewportEl.scrollTop = 0;
  }

  function markActiveSub(anchor) {
    var link = treeEl.querySelector('.tree-subs a[data-sub="' + CSS.escape(anchor) + '"]');
    if (link) link.classList.add("active");
  }

  function flash(node) {
    node.style.transition = "background-color .8s";
    node.style.backgroundColor = "var(--sel)";
    setTimeout(function () { node.style.backgroundColor = ""; }, 700);
  }

  function go(route, keepTerms) {
    if (!keepTerms) clearHighlight();
    var target = route.charAt(0) === "#" ? route : "#/" + route;
    if (location.hash === target) renderRoute();
    else location.hash = target;
  }

  function updatePrompt() {
    var path = state.page ? "~/" + state.page : "~";
    $("#ps1").textContent = "aws@og:" + path + "$";
  }

  /* ---------- in-document highlighting ---------- */

  function highlightInDoc(terms) {
    var pattern = terms.filter(Boolean).map(escapeRe).join("|");
    if (!pattern) return;
    var re = new RegExp("(" + pattern + ")", "gi");
    var walker = document.createTreeWalker(docEl, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var parent = node.parentNode.nodeName;
        if (parent === "SCRIPT" || parent === "STYLE" || parent === "MARK") {
          return NodeFilter.FILTER_REJECT;
        }
        return re.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    var targets = [], node;
    while ((node = walker.nextNode())) targets.push(node);

    targets.forEach(function (textNode) {
      var frag = document.createDocumentFragment();
      var text = textNode.nodeValue;
      var last = 0, match;
      re.lastIndex = 0;
      while ((match = re.exec(text))) {
        if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
        var mark = el("mark", null, match[0]);
        frag.appendChild(mark);
        last = match.index + match[0].length;
        if (match[0].length === 0) re.lastIndex++;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode.replaceChild(frag, textNode);
    });
  }

  function clearHighlight() {
    state.terms = [];
    var marks = docEl.querySelectorAll("mark");
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      m.parentNode.replaceChild(document.createTextNode(m.textContent), m);
    }
  }

  /* ---------- command palette ---------- */

  var paletteEl, paletteInput, paletteResults, paletteIndex = 0, paletteHits = [];

  function openPalette(initial) {
    paletteEl.hidden = false;
    paletteInput.value = initial || "";
    renderPalette();
    paletteInput.focus();
    paletteInput.select();
  }

  function closePalette() {
    paletteEl.hidden = true;
    $("#cmd").focus();
  }

  function renderPalette() {
    var query = paletteInput.value.trim();
    paletteResults.textContent = "";
    paletteIndex = 0;

    if (!query) {
      paletteHits = ORDER.slice(0, 12).map(function (id) {
        return { id: id, title: BY_ID[id].title, snippet: BY_ID[id].summary, hits: 0 };
      });
    } else {
      paletteHits = search(query, 40);
    }

    if (!paletteHits.length) {
      paletteResults.appendChild(el("p", "palette-empty", "no matches for “" + query + "”"));
      return;
    }

    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    paletteHits.forEach(function (hit, idx) {
      var item = el("a", "presult" + (idx === 0 ? " sel" : ""));
      item.href = "#/" + hit.id;
      item.dataset.nav = "1";
      item.dataset.idx = String(idx);
      item.innerHTML =
        '<span class="title">' + markTerms(hit.title, terms) + "</span>" +
        '<span class="meta">' + hit.id + (hit.hits ? " · " + plural(hit.hits, "hit") : "") + "</span>" +
        '<span class="snippet">' + markTerms(hit.snippet || "", terms) + "</span>";
      item.addEventListener("click", function (event) {
        event.preventDefault();
        commitPalette(idx);
      });
      paletteResults.appendChild(item);
    });
  }

  function movePalette(delta) {
    if (!paletteHits.length) return;
    var items = paletteResults.querySelectorAll(".presult");
    items[paletteIndex].classList.remove("sel");
    paletteIndex = (paletteIndex + delta + items.length) % items.length;
    items[paletteIndex].classList.add("sel");
    items[paletteIndex].scrollIntoView({ block: "nearest" });
  }

  function commitPalette(idx) {
    var hit = paletteHits[idx == null ? paletteIndex : idx];
    if (!hit) return;
    // renderRoute highlights state.terms and scrolls to the first hit.
    state.terms = paletteInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    closePalette();
    go(hit.id, true);
  }

  /* ---------- console output ---------- */

  var consoleEl, consoleLog;

  function print(node, echo) {
    var entry = el("div", "entry");
    if (echo) {
      var line = el("p", "echo");
      line.innerHTML = "<b>" + escapeHtml($("#ps1").textContent) + "</b> " + escapeHtml(echo);
      entry.appendChild(line);
    }
    if (typeof node === "string") {
      var pre = el("pre");
      pre.innerHTML = node;
      entry.appendChild(pre);
    } else if (node) {
      entry.appendChild(node);
    }
    consoleLog.appendChild(entry);
    consoleEl.hidden = false;
    consoleLog.scrollTop = consoleLog.scrollHeight;
  }

  function clearConsole() {
    consoleLog.textContent = "";
    consoleEl.hidden = true;
  }

  /* ---------- help overlay ---------- */

  var HELP_KEYS = [
    ["ctrl+k", "search everything"],
    ["/", "filter the section list"],
    ["?", "this panel"],
    ["esc", "close overlay / output"],
    ["[  ]", "previous / next section"],
    ["enter", "run the typed command"],
    ["tab", "complete command or section"],
    ["↑ ↓", "command history (at the prompt)"],
    ["any key", "starts typing at the prompt"]
  ];

  function renderHelp() {
    var grid = $("#help-grid");
    grid.textContent = "";
    HELP_KEYS.forEach(function (pair) {
      var row = document.createElement("div");
      row.innerHTML = "<span><kbd>" + escapeHtml(pair[0]) + "</kbd></span><span>" + escapeHtml(pair[1]) + "</span>";
      grid.appendChild(row);
    });
  }

  function toggleOverlay(node, on) {
    node.hidden = on == null ? !node.hidden : !on;
    if (node.hidden && node === $("#help")) $("#cmd").focus();
  }

  /* ---------- navigation helpers ---------- */

  function step(delta) {
    var pos = ORDER.indexOf(state.page);
    if (pos === -1) { go(delta > 0 ? ORDER[0] : ORDER[ORDER.length - 1]); return; }
    var next = pos + delta;
    if (next < 0 || next >= ORDER.length) return;
    go(ORDER[next]);
  }

  function resolveSection(name) {
    if (!name) return null;
    var key = String(name).trim().toLowerCase().replace(/\s+/g, "-").replace(/\/+$/, "");
    if (BY_ID[key]) return BY_ID[key];
    var alias = {
      "iam": "security-and-iam", "security": "security-and-iam", "ami": "amis",
      "elb": "load-balancers", "vpc": "vpcs-network-security-and-security-groups",
      "cost": "billing-and-cost-management", "billing": "billing-and-cost-management",
      "ha": "high-availability", "elasticip": "elastic-ips", "eip": "elastic-ips",
      "beanstalk": "elastic-beanstalk", "route53": "route-53", "aurora": "rds-aurora",
      "cfn": "cloudformation", "cw": "cloudwatch", "asg": "auto-scaling"
    };
    if (alias[key]) return BY_ID[alias[key]];
    var starts = ORDER.filter(function (id) { return id.indexOf(key) === 0; });
    if (starts.length === 1) return BY_ID[starts[0]];
    var loose = ORDER.filter(function (id) {
      return id.indexOf(key) !== -1 || BY_ID[id].title.toLowerCase().indexOf(key) !== -1;
    });
    if (loose.length === 1) return BY_ID[loose[0]];
    return null;
  }

  /* ---------- wiring ---------- */

  function onDocumentClick(event) {
    var link = event.target.closest("a[data-nav], a[href^='#/']");
    if (link && !link.target) {
      event.preventDefault();
      // Links printed by `grep` carry their query so the hit stays lit up.
      var carried = link.dataset.terms;
      if (carried) {
        state.terms = carried.split(/\s+/).filter(Boolean);
        go(link.getAttribute("href"), true);
      } else {
        go(link.getAttribute("href"));
      }
      return;
    }
    var button = event.target.closest("button[data-action]");
    if (button && button.dataset.action === "star") {
      toggleStar(state.page);
    }
  }

  function onGlobalKey(event) {
    var typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    var key = event.key;

    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "k") {
      event.preventDefault();
      openPalette(typing && document.activeElement.id === "cmd" ? document.activeElement.value : "");
      return;
    }

    if (key === "Escape") {
      if (!paletteEl.hidden) { closePalette(); return; }
      if (!$("#help").hidden) { toggleOverlay($("#help"), false); return; }
      if (!consoleEl.hidden) { clearConsole(); $("#cmd").focus(); return; }
      if (document.body.classList.contains("nav-open")) {
        document.body.classList.remove("nav-open");
        return;
      }
      if (docEl.querySelector("mark")) { clearHighlight(); return; }
      if (typing) document.activeElement.blur();
      return;
    }

    if (!paletteEl.hidden) return;

    if (typing) return;

    if (key === "/") { event.preventDefault(); filterEl.focus(); filterEl.select(); return; }
    if (key === "?") { event.preventDefault(); toggleOverlay($("#help")); return; }
    if (key === "[") { event.preventDefault(); step(-1); return; }
    if (key === "]") { event.preventDefault(); step(1); return; }

    // Anything else printable belongs at the prompt.
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      var cmd = $("#cmd");
      cmd.focus();
      cmd.value += key;
      event.preventDefault();
    }
  }

  function startClock() {
    var clock = $("#clock");
    function tick() {
      var now = new Date();
      clock.textContent = now.toTimeString().slice(0, 8);
    }
    tick();
    setInterval(tick, 1000);
  }

  function init() {
    treeEl = $("#tree");
    filterEl = $("#filter");
    docEl = $("#doc");
    footEl = $("#doc-foot");
    viewportEl = $("#viewport");
    crumbsEl = $("#crumbs");
    paletteEl = $("#palette");
    paletteInput = $("#palette-input");
    paletteResults = $("#palette-results");
    consoleEl = $("#console");
    consoleLog = $("#console-log");

    setTheme(state.theme);
    setCrt(state.crt !== "off");
    setFontSize(state.fontSize);
    renderHelp();
    startClock();

    $("#corpus-stats").textContent =
      META.sectionCount + " sections · " + META.wordCount.toLocaleString() + " words · offline";

    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onGlobalKey);
    // Highlight terms are cleared by whoever navigates (link clicks do it);
    // the palette sets them deliberately just before changing the hash.
    window.addEventListener("hashchange", renderRoute);

    filterEl.addEventListener("input", function () { renderTree(filterEl.value); });
    filterEl.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        var first = treeEl.querySelector(".tree-item");
        if (first) { go(first.getAttribute("href")); filterEl.blur(); }
      }
    });

    paletteInput.addEventListener("input", renderPalette);
    paletteInput.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") { event.preventDefault(); movePalette(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); movePalette(-1); }
      else if (event.key === "Enter") { event.preventDefault(); commitPalette(); }
    });
    paletteEl.addEventListener("click", function (event) {
      if (event.target === paletteEl) closePalette();
    });
    $("#help").addEventListener("click", function (event) {
      if (event.target === $("#help")) toggleOverlay($("#help"), false);
    });

    $("#search-btn").addEventListener("click", function () { openPalette(""); });
    $("#theme-btn").addEventListener("click", cycleTheme);
    $("#console-close").addEventListener("click", function () { clearConsole(); $("#cmd").focus(); });
    $("#menu-btn").addEventListener("click", function () {
      var open = document.body.classList.toggle("nav-open");
      this.setAttribute("aria-expanded", String(open));
    });

    renderRoute();

    // Warm the search index once the first paint is done.
    setTimeout(buildIndex, 400);
  }

  window.AWSMAN = {
    meta: META,
    sections: SECTIONS,
    groups: GROUPS,
    byId: BY_ID,
    order: ORDER,
    groupLabel: GROUP_LABEL,
    themes: THEMES,
    state: state,
    go: go,
    step: step,
    search: search,
    buildIndex: buildIndex,
    resolveSection: resolveSection,
    stripTags: stripTags,
    escapeHtml: escapeHtml,
    print: print,
    clearConsole: clearConsole,
    openPalette: openPalette,
    toggleHelp: function () { toggleOverlay($("#help")); },
    setTheme: setTheme,
    cycleTheme: cycleTheme,
    setCrt: setCrt,
    setFontSize: setFontSize,
    toggleStar: toggleStar,
    isStarred: isStarred,
    highlight: function (terms) { state.terms = terms; highlightInDoc(terms); },
    clearHighlight: clearHighlight,
    renderTree: function () { renderTree(filterEl.value); }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
