// Small enhancements. Every page works without this file: links are links, the email is a
// mailto, the theme follows the system. With it: a theme switch, copy-to-clipboard, a
// contents list that follows the reader, and a print button on the CV.
(function () {
  "use strict";
  var root = document.documentElement;
  var darkQuery = matchMedia("(prefers-color-scheme: dark)");

  // ---- theme switch -----------------------------------------------------------------------
  function current() {
    return root.dataset.theme || (darkQuery.matches ? "dark" : "light");
  }
  function paintMeta() {
    var bg = getComputedStyle(root).getPropertyValue("--bg").trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      if (root.dataset.theme) m.setAttribute("content", bg);
    });
  }
  document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
    var label = btn.querySelector(".theme-label");
    function sync() {
      var now = current();
      var next = now === "dark" ? "light" : "dark";
      if (label) label.textContent = next;
      btn.setAttribute("aria-label", "Theme: " + now + ". Switch to " + next);
    }
    sync();
    btn.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (e) {}
      sync();
      paintMeta();
    });
    darkQuery.addEventListener("change", sync);
  });
  paintMeta();

  // ---- copy the email address ------------------------------------------------------------
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    if (!navigator.clipboard) { btn.hidden = true; return; }
    var status = document.getElementById(btn.getAttribute("aria-describedby") || "");
    var timer = 0;
    btn.addEventListener("click", function () {
      navigator.clipboard.writeText(btn.dataset.copy).then(function () {
        if (status) status.textContent = "Copied";
        clearTimeout(timer);
        timer = setTimeout(function () { if (status) status.textContent = ""; }, 2400);
      }, function () {
        if (status) status.textContent = "Copy failed, select the address instead";
      });
    });
  });

  // ---- contents list: mark the section being read --------------------------------------------
  var tocLinks = document.querySelectorAll(".toc a[href^='#']");
  if (tocLinks.length && "IntersectionObserver" in window) {
    var byId = {};
    tocLinks.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible[e.target.id] = e.isIntersecting; });
      var first = null;
      tocLinks.forEach(function (a) {
        var id = a.getAttribute("href").slice(1);
        if (!first && visible[id]) first = a;
      });
      if (!first) return;
      tocLinks.forEach(function (a) {
        if (a === first) a.setAttribute("aria-current", "location");
        else a.removeAttribute("aria-current");
      });
    }, { rootMargin: "-20% 0px -55% 0px" });
    Object.keys(byId).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }

  // ---- print button on the CV ---------------------------------------------------------------
  document.querySelectorAll("[data-print]").forEach(function (btn) {
    btn.addEventListener("click", function () { window.print(); });
  });
})();
