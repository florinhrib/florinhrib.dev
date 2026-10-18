// Runs before first paint: marks that scripts run (so script-only buttons take their place
// without a layout shift) and applies a saved theme choice so it never flashes the other one.
document.documentElement.classList.add("js");
try {
  var saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
} catch (e) {}
