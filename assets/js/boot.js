/* aws.manual — boot sequence. Cosmetic, skippable, once per session. */

(function () {
  "use strict";

  var A = window.AWSMAN;
  var bootEl = document.getElementById("boot");
  var logEl = document.getElementById("boot-log");
  var cmd = document.getElementById("cmd");
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var running = false;
  var timers = [];

  function lines() {
    var meta = (A && A.meta) || { revision: "?", sectionCount: 0, wordCount: 0, built: "" };
    return [
      "aws.manual bios v1.0 — offline reference unit",
      "",
      "post ......................................... ok",
      "mount /guide (og-aws @ " + meta.revision + ") ............ ok",
      "load " + meta.sectionCount + " sections / " + meta.wordCount.toLocaleString() + " words ............ ok",
      "fonts (vendored) ............................. ok",
      "network interface ............................ down (by design)",
      "region ....................................... local-1a",
      "",
      "ready. type `help`, or ctrl+k to search.",
      ""
    ];
  }

  function finish() {
    running = false;
    timers.forEach(clearTimeout);
    timers = [];
    bootEl.hidden = true;
    document.removeEventListener("keydown", skip, true);
    document.removeEventListener("pointerdown", skip, true);
    if (cmd && window.innerWidth > 860) cmd.focus();
  }

  function skip() {
    if (running) finish();
  }

  function start() {
    var script = lines();
    running = true;
    logEl.textContent = "";
    bootEl.hidden = false;
    document.addEventListener("keydown", skip, true);
    document.addEventListener("pointerdown", skip, true);

    if (reduced) { finish(); return; }

    var delay = 0;
    script.forEach(function (line, i) {
      delay += line ? 90 : 40;
      timers.push(setTimeout(function () {
        logEl.textContent += line + "\n";
      }, delay));
    });
    timers.push(setTimeout(finish, delay + 420));
  }

  var KEY = "aws.manual:booted";
  var seen = false;
  try { seen = sessionStorage.getItem(KEY) === "1"; } catch (e) { seen = false; }

  if (seen) {
    bootEl.hidden = true;
    if (cmd && window.innerWidth > 860) cmd.focus();
  } else {
    try { sessionStorage.setItem(KEY, "1"); } catch (e) { /* ignore */ }
    start();
  }

  window.AWSBOOT = { replay: start };

  // A service worker makes the site work offline when it is *served* over
  // http(s); opened straight from disk it is already offline, and the
  // registration is skipped.
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* fine without it */ });
    });
  }
})();
