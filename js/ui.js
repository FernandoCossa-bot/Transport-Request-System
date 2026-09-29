/* Presentation shared by every page. Database code remains in app.js. */
(() => {
  "use strict";
  const root = document.documentElement;
  const darkPreference = matchMedia("(prefers-color-scheme: dark)");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Storage is optional. */ } };
  let theme = read("transport-theme");
  if (!["light", "dark"].includes(theme)) theme = null;
  let paused = read("transport-motion") === "off";
  root.dataset.theme = theme || (darkPreference.matches ? "dark" : "light");
  root.dataset.motion = paused || reducedMotion.matches ? "off" : "on";
  const paths = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    moon: '<path d="M20 15.7A8.5 8.5 0 0 1 8.3 4a8.5 8.5 0 1 0 11.7 11.7Z"/>',
    vehicle: '<path d="m4 10 2-5h12l2 5v9H4V10ZM4 11h16M7 19v2m10-2v2M7 15h2m6 0h2"/>'
  };
  function icon(name) {
    const template = document.createElement("template");
    // Only the static paths above become markup. Database values use textContent.
    template.innerHTML = '<svg viewBox="0 0 24 24" class="icon" aria-hidden="true">' + paths[name] + '</svg>';
    return template.content.firstElementChild;
  }
  function initializeInterface() {
    const themeButton = document.querySelector("#theme-toggle");
    function updateTheme() {
      if (!themeButton) return;
      const isDark = root.dataset.theme === "dark";
      const text = document.createElement("span"); text.textContent = isDark ? "Light mode" : "Dark mode";
      themeButton.replaceChildren(icon(isDark ? "sun" : "moon"), text);
      themeButton.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
      themeButton.title = themeButton.getAttribute("aria-label");
    }
    themeButton?.addEventListener("click", () => {
      theme = root.dataset.theme === "dark" ? "light" : "dark";
      root.dataset.theme = theme; save("transport-theme", theme); updateTheme();
    });
    darkPreference.addEventListener("change", () => {
      if (!theme) root.dataset.theme = darkPreference.matches ? "dark" : "light";
      updateTheme();
    });
    updateTheme();
    const scene = document.querySelector(".route-scene");
    const motionButton = document.querySelector("#motion-toggle");
    function updateMotion() {
      root.dataset.motion = paused || reducedMotion.matches ? "off" : "on";
      if (motionButton) {
        motionButton.disabled = reducedMotion.matches;
        motionButton.textContent = reducedMotion.matches ? "Reduced motion enabled" : paused ? "Resume motion" : "Pause motion";
      }
      scene?.style.removeProperty("--tilt-x"); scene?.style.removeProperty("--tilt-y");
    }
    motionButton?.addEventListener("click", () => { paused = !paused; save("transport-motion", paused ? "off" : "on"); updateMotion(); });
    reducedMotion.addEventListener("change", updateMotion);
    updateMotion();
    scene?.addEventListener("pointermove", event => {
      if (root.dataset.motion === "off" || !finePointer.matches) return;
      const box = scene.getBoundingClientRect();
      scene.style.setProperty("--tilt-x", ((.5 - (event.clientY - box.top) / box.height) * 7).toFixed(2) + "deg");
      scene.style.setProperty("--tilt-y", (((event.clientX - box.left) / box.width - .5) * 9).toFixed(2) + "deg");
    });
    scene?.addEventListener("pointerleave", () => { scene.style.removeProperty("--tilt-x"); scene.style.removeProperty("--tilt-y"); });
    const clock = document.querySelector("#local-time");
    if (clock) {
      const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Maputo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      const updateClock = () => { clock.textContent = formatter.format(new Date()); };
      updateClock(); setInterval(updateClock, 60000);
    }
    // Warn before navigating away from an edited form. No personal data is stored.
    let dirty = false;
    for (const form of document.querySelectorAll("form")) {
      form.addEventListener("input", () => { dirty = true; });
      form.addEventListener("change", () => { dirty = true; });
      form.addEventListener("reset", () => { dirty = false; });
    }
    window.addEventListener("beforeunload", event => {
      if (!dirty) return;
      event.preventDefault(); event.returnValue = "";
    });
    function decorateResults() {
      document.querySelectorAll("#vehicle-list > p:not([data-ui-decorated])").forEach(row => {
        const parts = row.textContent.split(" — ");
        if (parts.length < 2) return;
        row.dataset.uiDecorated = "true"; row.classList.add("fleet-card");
        const symbol = document.createElement("span"); symbol.className = "fleet-symbol"; symbol.appendChild(icon("vehicle"));
        const content = document.createElement("span");
        const plate = document.createElement("strong"); plate.textContent = parts.shift();
        const model = document.createElement("small"); model.textContent = parts.join(" — ");
        content.append(plate, model); row.replaceChildren(symbol, content);
      });
      document.querySelectorAll(".request-card h3:not([data-ui-decorated])").forEach(heading => {
        const match = heading.textContent.match(/^(Request #\d+) - (Pending|Approved|Postponed|Completed|Cancelled)$/);
        if (!match) return;
        heading.dataset.uiDecorated = "true";
        const title = document.createElement("span"); title.textContent = match[1];
        const badge = document.createElement("span"); badge.className = "status-badge"; badge.dataset.status = match[2].toLowerCase(); badge.textContent = match[2];
        heading.replaceChildren(title, badge);
      });
      document.querySelectorAll("#vehicle-form-message, #request-form-message, #connection-status").forEach(message => {
        if (/could not|failed|not saved|already exists|does not permit|must |missing/i.test(message.textContent)) message.dataset.state = "error";
        else if (/saved successfully|updated from|Registered vehicles|records loaded/i.test(message.textContent)) message.dataset.state = "success";
        else message.dataset.state = "info";
      });
    }
    const main = document.querySelector("main");
    if (main) {
      let scheduled = false;
      new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; decorateResults(); });
      }).observe(main, { childList: true, subtree: true, characterData: true });
      decorateResults();
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeInterface, { once: true });
  else initializeInterface();
})();

