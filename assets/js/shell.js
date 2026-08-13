/* aws.manual — the command line. Every command works with no network. */

(function () {
  "use strict";

  var A = window.AWSMAN;
  if (!A) return;

  var input = document.getElementById("cmd");
  var hint = document.getElementById("hint");
  var history = [];
  var historyPos = -1;
  var draft = "";

  var esc = A.escapeHtml;

  function link(id, label) {
    return '<a href="#/' + id + '" data-nav="1">' + esc(label || id) + "</a>";
  }

  function pad(str, width) {
    str = String(str);
    return str.length >= width ? str : str + new Array(width - str.length + 1).join(" ");
  }

  function ok(text) { return '<span class="ok">' + text + "</span>"; }
  function err(text) { return '<span class="err">' + text + "</span>"; }

  /* ---------- commands ---------- */

  var COMMANDS = {};

  function define(names, usage, blurb, run) {
    var spec = { names: names, usage: usage, blurb: blurb, run: run };
    names.forEach(function (name) { COMMANDS[name] = spec; });
  }

  define(["help", "?"], "help [command]", "list commands, or explain one", function (args) {
    if (args[0] && COMMANDS[args[0]]) {
      var spec = COMMANDS[args[0]];
      return pad(spec.usage, 28) + spec.blurb +
        (spec.names.length > 1 ? "\naliases: " + spec.names.join(", ") : "");
    }
    var seen = [], lines = ["commands — arguments in [] are optional", ""];
    Object.keys(COMMANDS).forEach(function (name) {
      var spec = COMMANDS[name];
      if (seen.indexOf(spec) !== -1) return;
      seen.push(spec);
      lines.push("  " + pad(esc(spec.usage), 30) + esc(spec.blurb));
    });
    lines.push("", "press ? for keyboard shortcuts · ctrl+k to search");
    return lines.join("\n");
  });

  define(["ls", "dir"], "ls [group]", "list sections, optionally one group", function (args) {
    var wanted = (args[0] || "").toLowerCase();
    var out = [];
    A.groups.forEach(function (group) {
      if (wanted && group.id.indexOf(wanted) !== 0 && group.label.indexOf(wanted) === -1) return;
      out.push(esc(group.label) + "/");
      var row = [];
      group.sections.forEach(function (id, i) {
        row.push(pad(link(id, id) + (A.isStarred(id) ? " ★" : ""), 0));
        if ((i + 1) % 3 === 0) { out.push("  " + row.join("   ")); row = []; }
      });
      if (row.length) out.push("  " + row.join("   "));
      out.push("");
    });
    if (!out.length) return err("ls: " + esc(wanted) + ": no such group");
    return out.join("\n");
  });

  define(["tree"], "tree", "the whole guide, with subsections", function () {
    var out = [];
    A.groups.forEach(function (group) {
      out.push(esc(group.label));
      group.sections.forEach(function (id, i) {
        var sec = A.byId[id];
        var last = i === group.sections.length - 1;
        out.push((last ? "└── " : "├── ") + link(id, sec.title));
        sec.subs.slice(0, 8).forEach(function (sub, j) {
          var lead = last ? "    " : "│   ";
          var branch = j === Math.min(sec.subs.length, 8) - 1 ? "└── " : "├── ";
          out.push(lead + branch +
            '<a href="#/' + id + "#" + sub.id + '" data-nav="1">' + esc(sub.title) + "</a>");
        });
      });
      out.push("");
    });
    return out.join("\n");
  });

  define(["cd", "open", "man", "go"], "man <section>", "open a section", function (args) {
    if (!args.length) { A.go(""); return ok("~"); }
    if (args[0] === "..") { A.go(""); return ok("~"); }
    var sec = A.resolveSection(args.join(" "));
    if (!sec) return err("man: no entry for " + esc(args.join(" ")) + " — try `grep " + esc(args.join(" ")) + "`");
    A.go(sec.id);
    return ok(sec.title) + " — " + esc(sec.summary.slice(0, 160)) + "…";
  });

  define(["cat", "less"], "cat <section>", "dump a section as plain text", function (args) {
    var sec = A.resolveSection(args.join(" "));
    if (!sec) return err("cat: " + esc(args.join(" ")) + ": No such section");
    var text = A.stripTags(sec.html);
    var limit = 3200;
    var body = esc(text.slice(0, limit));
    if (text.length > limit) {
      body += "\n\n" + err("[truncated " + (text.length - limit).toLocaleString() + " chars] ") +
        link(sec.id, "open " + sec.id + " to read it properly");
    }
    return body;
  });

  define(["head", "summary"], "head <section>", "one-paragraph summary", function (args) {
    var sec = A.resolveSection(args.join(" "));
    if (!sec) return err("head: " + esc(args.join(" ")) + ": No such section");
    var tags = sec.tags.map(function (t) { return t.emoji + t.count; }).join(" ");
    return link(sec.id, sec.title) + "  " + esc(tags) + "\n" + esc(sec.summary);
  });

  define(["grep", "search", "find", "rg"], "grep <words…>", "full-text search the guide", function (args) {
    var query = args.join(" ").replace(/^-[a-z]+\s*/, "");
    if (!query) return err("grep: give me something to look for");
    var hits = A.search(query, 14);
    if (!hits.length) return "no matches for " + esc(query);
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    var out = [esc(hits.length >= 14 ? "top 14 matches" : hits.length + " matching sections") + " for “" + esc(query) + "”", ""];
    var carry = ' data-terms="' + esc(terms.join(" ")) + '"';
    hits.forEach(function (hit) {
      out.push('<span class="hit"><span class="path">' +
        '<a href="#/' + hit.id + '" data-nav="1"' + carry + ">" + esc(hit.id) + "</a></span>" +
        "  " + esc(hit.hits ? hit.hits + "×" : "title") +
        '\n  <span class="snip">' + highlight(hit.snippet, terms) + "</span></span>");
    });
    out.push("", "ctrl+k opens the same search with arrow-key navigation");
    A.state.terms = terms;
    return out.join("\n");
  });

  function highlight(text, terms) {
    var out = esc(text);
    terms.forEach(function (term) {
      if (!term) return;
      out = out.replace(
        new RegExp("(" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi"),
        "<mark>$1</mark>"
      );
    });
    return out;
  }

  define(["tags", "marks"], "tags [name]", "sections carrying a legend mark", function (args) {
    var wanted = (args[0] || "").toLowerCase();
    if (!wanted) {
      return A.meta.legend.map(function (t) {
        return "  " + t.emoji + "  " + pad(t.key, 12) + esc(t.label);
      }).join("\n") + "\n\ne.g. `tags gotcha`, `tags cost`, `tags lockin`";
    }
    var known = A.meta.legend.filter(function (t) { return t.key.indexOf(wanted) === 0; })[0];
    if (!known) return err("tags: unknown mark " + esc(wanted));
    var rows = A.sections.map(function (sec) {
      var found = sec.tags.filter(function (t) { return t.key === known.key; })[0];
      return found ? { id: sec.id, count: found.count } : null;
    }).filter(Boolean).sort(function (a, b) { return b.count - a.count; });
    if (!rows.length) return "no sections carry " + known.emoji;
    return known.emoji + " " + esc(known.label) + " — " + rows.length + " sections\n\n" +
      rows.map(function (r) { return "  " + pad(String(r.count), 5) + link(r.id); }).join("\n");
  });

  define(["legend"], "legend", "what the marks mean", function () {
    A.go("legend");
    return ok("legend");
  });

  define(["star", "unstar", "bookmark"], "star [section]", "toggle a bookmark", function (args, name) {
    var sec = args.length ? A.resolveSection(args.join(" ")) : A.byId[A.state.page];
    if (!sec) return err(name + ": which section?");
    var on = A.toggleStar(sec.id);
    return (on ? "★ starred " : "☆ unstarred ") + link(sec.id, sec.title);
  });

  define(["stars", "bookmarks"], "stars", "list bookmarks", function () {
    if (!A.state.stars.length) return "no bookmarks yet — `star` on any section";
    return A.state.stars.map(function (id) { return "  ★ " + link(id, A.byId[id].title); }).join("\n");
  });

  define(["recent"], "recent", "recently opened sections", function () {
    if (!A.state.recents.length) return "nothing opened yet";
    return A.state.recents.map(function (id) { return "  " + link(id, A.byId[id].title); }).join("\n");
  });

  define(["random", "lucky"], "random", "open a section at random", function () {
    var id = A.order[Math.floor(Math.random() * A.order.length)];
    A.go(id);
    return ok("→ " + A.byId[id].title);
  });

  define(["next"], "next", "next section", function () { A.step(1); return ok("→"); });
  define(["prev", "back"], "prev", "previous section", function () { A.step(-1); return ok("←"); });

  define(["theme"], "theme [name]", "phosphor · amber · ice · synth · paper", function (args) {
    if (!args[0]) {
      return "themes: " + A.themes.map(function (t) {
        return t === A.state.theme ? "[" + t + "]" : t;
      }).join("  ");
    }
    if (args[0] === "next") return "theme: " + A.cycleTheme();
    if (!A.setTheme(args[0])) return err("theme: unknown theme " + esc(args[0]));
    return "theme: " + args[0];
  });

  define(["crt"], "crt [on|off]", "scanlines and glow", function (args) {
    var on = args[0] ? args[0] !== "off" : A.state.crt === "off";
    return "crt: " + A.setCrt(on);
  });

  define(["font", "zoom"], "font [+|-|size]", "text size", function (args) {
    var arg = args[0] || "";
    var size = A.state.fontSize;
    if (arg === "+" || arg === "up") size += 1;
    else if (arg === "-" || arg === "down") size -= 1;
    else if (/^\d+$/.test(arg)) size = parseInt(arg, 10);
    else if (arg === "reset") size = 14;
    return "font: " + A.setFontSize(size) + "px";
  });

  define(["clear", "cls"], "clear", "clear this output", function () {
    A.clearConsole();
    return null;
  });

  define(["history"], "history", "commands you have run", function () {
    if (!history.length) return "(empty)";
    return history.map(function (line, i) { return "  " + pad(String(i + 1), 5) + esc(line); }).join("\n");
  });

  define(["stats", "df"], "stats", "corpus statistics", function () {
    var services = (A.groups.filter(function (g) { return g.id === "services"; })[0] || {}).sections || [];
    var totalSubs = A.sections.reduce(function (n, s) { return n + s.subs.length; }, 0);
    var biggest = A.sections.slice().sort(function (a, b) { return b.words - a.words; }).slice(0, 5);
    return [
      "  " + pad("sections", 16) + A.meta.sectionCount,
      "  " + pad("services", 16) + services.length,
      "  " + pad("subsections", 16) + totalSubs,
      "  " + pad("words", 16) + A.meta.wordCount.toLocaleString(),
      "  " + pad("source rev", 16) + esc(A.meta.revision),
      "  " + pad("generated", 16) + esc(A.meta.built),
      "  " + pad("license", 16) + esc(A.meta.license),
      "",
      "  longest sections:",
      biggest.map(function (s) {
        return "    " + pad(s.words.toLocaleString(), 8) + link(s.id, s.title);
      }).join("\n")
    ].join("\n");
  });

  define(["neofetch", "about"], "neofetch", "the obligatory system readout", function () {
    var art = [
      "   ╔═══════════╗",
      "   ║ ▚▚▚ ░░░░░ ║",
      "   ║ ░░░ ▚▚▚▚▚ ║",
      "   ║ ▚▚▚▚▚ ░░░ ║",
      "   ╚═══════════╝"
    ];
    var info = [
      "guest@aws.manual",
      "-----------------",
      "guide:    The Open Guide to AWS",
      "upstream: open-guides/og-aws @ " + A.meta.revision,
      "sections: " + A.meta.sectionCount,
      "words:    " + A.meta.wordCount.toLocaleString(),
      "built:    " + A.meta.built,
      "theme:    " + A.state.theme + " / crt " + A.state.crt,
      "network:  not required",
      "license:  " + A.meta.license
    ];
    var lines = [];
    for (var i = 0; i < Math.max(art.length, info.length); i++) {
      lines.push(pad(art[i] || "", 18) + "  " + esc(info[i] || ""));
    }
    return lines.join("\n");
  });

  define(["source", "upstream"], "source", "where this content comes from", function () {
    return "content: " + '<a href="' + A.meta.upstream + '" target="_blank" rel="noopener noreferrer" class="ext">' +
      esc(A.meta.upstream) + "</a>\n" +
      "license: " + link("license", A.meta.license) + " · full text: " + link("license-full", "license-full") + "\n" +
      "credits: " + link("credits", "the og-aws contributors") + "\n" +
      "rebuilt offline; not affiliated with Amazon Web Services.";
  });

  define(["license"], "license", "licensing summary", function () { A.go("license"); return ok("license"); });
  define(["credits", "authors"], "credits", "who wrote the guide", function () { A.go("credits"); return ok("credits"); });
  define(["contributing"], "contributing", "how upstream takes changes", function () { A.go("contributing"); return ok("contributing"); });

  define(["pwd"], "pwd", "current section", function () {
    return A.state.page ? "~/" + A.state.page : "~";
  });

  define(["whoami"], "whoami", "you", function () { return "guest — reading AWS docs at 3am, offline"; });
  define(["uname"], "uname", "system", function () {
    return "aws.manual 1.0 static/offline " + A.meta.revision + " (" + navigator.platform + ")";
  });
  define(["date"], "date", "the time", function () { return new Date().toString(); });
  define(["echo"], "echo <text>", "say it back", function (args) { return esc(args.join(" ")); });

  define(["sudo"], "sudo <command>", "no", function (args) {
    if (!args.length) return err("usage: sudo <command>");
    return err("guest is not in the sudoers file. This incident has been reported to " +
      "us-east-1, which is currently degraded.");
  });

  define(["exit", "quit", "logout"], "exit", "close the session", function () {
    return "there is no exit from AWS billing. try " + link("billing-and-cost-management", "billing") + ".";
  });

  define(["boot"], "boot", "replay the boot sequence", function () {
    if (window.AWSBOOT) { window.AWSBOOT.replay(); return null; }
    return err("boot: sequence unavailable");
  });

  define(["print"], "print", "open the browser print dialog", function () {
    setTimeout(function () { window.print(); }, 50);
    return "sending " + (A.state.page || "index") + " to the printer…";
  });

  /* ---------- execution ---------- */

  function run(line) {
    var parts = line.trim().split(/\s+/);
    var name = (parts.shift() || "").toLowerCase();
    if (!name) return;

    var spec = COMMANDS[name];
    if (!spec) {
      // Bare section names are a common typo-free path: `s3`, `ec2 tips`.
      var sec = A.resolveSection(line);
      if (sec) {
        A.go(sec.id);
        A.print(ok(sec.title) + " — " + esc(sec.summary.slice(0, 160)) + "…", line);
        return;
      }
      A.print(err(name + ": command not found — try `help`, or `grep " + esc(line) + "`"), line);
      return;
    }

    var output;
    try {
      output = spec.run(parts, name);
    } catch (e) {
      output = err(name + ": " + esc(e.message));
    }
    if (output !== null && output !== undefined) A.print(output, line);
  }

  /* ---------- completion ---------- */

  function complete(value) {
    var parts = value.split(/\s+/);
    var head = parts[0] || "";
    if (parts.length <= 1) {
      var names = Object.keys(COMMANDS).concat(A.order);
      return pickCompletion(head, names, "");
    }
    var tail = parts[parts.length - 1];
    var prefix = parts.slice(0, -1).join(" ") + " ";
    return pickCompletion(tail, A.order, prefix);
  }

  function pickCompletion(fragment, candidates, prefix) {
    if (!fragment) return null;
    var matches = candidates.filter(function (name) { return name.indexOf(fragment) === 0; });
    if (!matches.length) return null;
    if (matches.length === 1) return { value: prefix + matches[0] + " ", list: null };
    var common = matches[0];
    matches.forEach(function (name) {
      var i = 0;
      while (i < common.length && i < name.length && common[i] === name[i]) i++;
      common = common.slice(0, i);
    });
    return { value: prefix + common, list: matches };
  }

  /* ---------- prompt input ---------- */

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      var line = input.value.trim();
      input.value = "";
      if (!line) return;
      history.push(line);
      historyPos = history.length;
      run(line);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      var result = complete(input.value);
      if (!result) return;
      input.value = result.value;
      if (result.list) {
        A.print(result.list.map(function (name) { return "  " + esc(name); }).join("\n"), null);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (historyPos === history.length) draft = input.value;
      historyPos = Math.max(0, historyPos - 1);
      if (history[historyPos] != null) input.value = history[historyPos];
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      historyPos = Math.min(history.length, historyPos + 1);
      input.value = historyPos === history.length ? draft : history[historyPos];
      return;
    }

    if (event.key === "l" && event.ctrlKey) {
      event.preventDefault();
      A.clearConsole();
      return;
    }

    if (event.key === "u" && event.ctrlKey) {
      event.preventDefault();
      input.value = "";
    }
  });

  input.addEventListener("input", function () {
    var head = input.value.trim().split(/\s+/)[0].toLowerCase();
    var spec = COMMANDS[head];
    hint.textContent = spec ? spec.usage : (input.value ? "tab completes" : "help");
  });

  window.AWSSHELL = { run: run, commands: COMMANDS };
})();
