(() => {
  "use strict";
  const crmOrigin = "https://partnercrm.leadgensolution.hu";
  const key = "28e9d9f97b166b213f6693213b921780";
  const endpoint = crmOrigin + "/api/public/forms/" + key;
  const form = document.getElementById("webinar-form");
  const errorBox = document.getElementById("form-error");
  const fallback = document.getElementById("direct-form");
  const success = document.getElementById("siker");
  const steps = Array.from(form.querySelectorAll(".step"));
  const stepTitle = document.getElementById("step-title");
  const stepNum = document.getElementById("step-num");
  const progress = form.querySelector(".step-progress");
  const back = form.querySelector(".step-back");
  const next = form.querySelector(".step-next");
  const [nextText, nextIcon] = next.querySelectorAll("span");
  // Same as the CRM form's partial_capture_after_step: from here on every
  // "next" saves the registration, so a visitor who stops later is not lost.
  const PARTIAL_AFTER_STEP = 3;
  const campaign = new URLSearchParams();
  const query = new URLSearchParams(location.search);
  for (const name of ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id","fbclid","gclid","msclkid","ttclid","li_fat_id"]) {
    if (query.get(name)) campaign.set(name, query.get(name));
  }
  const landingTime = Date.now();
  const landingUrl = new URL(location.pathname, location.origin);
  landingUrl.search = campaign.toString();
  const directLink = new URL(fallback.querySelector("a").href);
  directLink.search = campaign.toString();
  fallback.querySelector("a").href = directLink.href;
  const choices = document.getElementById("webinar-idopontok");
  const dateFormat = new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest", month: "long", day: "numeric", weekday: "long"
  });
  const timeFormat = new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  const isoDay = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit"
  });
  let session;
  let busy = false;
  let current = 0;
  let resume = null;
  let queue = Promise.resolve();
  let partialReported = false;
  document.getElementById("step-total").textContent = steps.length;

  // crypto.randomUUID is missing from older in-app browsers (iOS < 15.4, Chrome < 92).
  function newEventId() {
    try {
      if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    }
  }

  // Email and phone are hashed (SHA-256) by /api/capi before they reach Meta.
  // Measured like the Training Hungary webinar form: LeadPartial once the
  // phone step is valid, Lead only for a completed registration.
  async function reportMetaEvent(eventName, email, phone) {
    const event = {
      event_name: eventName,
      event_id: newEventId(),
      event_source_url: location.origin + location.pathname,
      custom_data: { content_name: "Kreativo webinár" },
      email,
      phone
    };
    const clickId = campaign.get("fbclid");
    if (clickId && /^[A-Za-z0-9_-]{1,1000}$/.test(clickId)) {
      event.fbc = "fb.1." + landingTime + "." + clickId;
    }
    await fetch("/api/capi", {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      keepalive: true
    });
  }

  async function loadSession() {
    const response = await fetch(endpoint, { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw new Error("Az űrlap jelenleg nem érhető el.");
    const data = await response.json();
    if (!data.token || !data.ts) throw new Error("A regisztrációt nem sikerült előkészíteni.");
    return data;
  }

  function displaySessions(value) {
    const field = value.webinar_selection?.field_key;
    const options = value.webinar_sessions || [];
    if (!field || value.webinar_selection.mode !== "single" || !Array.isArray(options)) {
      throw new Error("Az időpontválasztó nem tölthető be.");
    }
    const previous = choices.querySelector("input:checked")?.value;
    const fragment = document.createDocumentFragment();
    for (const option of options) {
      const date = new Date(option.scheduled_at);
      if (!option.id || !Number.isFinite(date.getTime())) continue;
      const label = document.createElement("label");
      label.className = "session-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = field;
      input.value = option.id;
      input.required = true;
      input.checked = previous === option.id;
      const details = document.createElement("span");
      const day = document.createElement("small");
      day.textContent = dateFormat.format(date);
      const hour = document.createElement("strong");
      hour.textContent = timeFormat.format(date);
      details.append(day, hour);
      label.append(input, details);
      fragment.append(label);
    }
    choices.replaceChildren(fragment);
    session = value;
    if (!choices.childElementCount) {
      form.hidden = true;
      throw new Error("Jelenleg nincs választható időpont.");
    }
  }

  function headline(index) {
    if (index === 0) return "Foglalja le a helyét";
    if (index === steps.length - 1) return "Utolsó lépés";
    return "Még " + (steps.length - index) + " lépés";
  }

  function showStep(index, moveFocus = true) {
    const changed = index !== current;
    current = index;
    steps.forEach((step, n) => { step.hidden = n !== index; });
    const step = steps[index];
    if (changed) {
      step.classList.remove("step-enter");
      void step.offsetWidth;
      step.classList.add("step-enter");
    }
    // Goal gradient: the bar starts at 20% instead of zero.
    const done = Math.round((0.2 + 0.8 * index / steps.length) * 100);
    progress.firstElementChild.style.width = done + "%";
    progress.setAttribute("aria-valuenow", String(done));
    stepTitle.textContent = headline(index);
    stepNum.textContent = String(index + 1);
    updateNav();
    if (moveFocus) step.querySelector('input:not([type="radio"]), textarea')?.focus();
  }

  function updateNav() {
    back.disabled = current === 0;
    const last = current === steps.length - 1;
    nextText.textContent = last ? "Jelentkezem az ingyenes webinárra" : "Tovább";
    nextIcon.textContent = last ? "↗" : "→";
  }

  function validateStep(index) {
    const step = steps[index];
    const phone = form.elements.namedItem("telefonszam");
    const tax = form.elements.namedItem("adoszam");
    if (step.contains(phone)) {
      const digits = phone.value.replace(/\D/g, "").length;
      phone.setCustomValidity(digits < 7 || digits > 15 ? "A telefonszám 7–15 számjegyet tartalmazhat." : "");
    }
    if (step.contains(tax)) {
      const digits = tax.value.replace(/\D/g, "").length;
      tax.setCustomValidity(tax.value.trim() && digits !== 11 ? "Az adószám 11 számjegyből áll." : "");
    }
    for (const field of step.querySelectorAll("input, textarea")) {
      if (!field.checkValidity()) {
        field.reportValidity();
        return false;
      }
    }
    return true;
  }

  // Built when the request is sent, so it carries the latest resume token.
  async function postToCrm(partial) {
    const data = Object.fromEntries(new FormData(form));
    Object.assign(data, Object.fromEntries(campaign), {
      _token: session.token, _ts: session.ts, _channel: "embed",
      landing_url: landingUrl.href, page_url: landingUrl.href
    });
    if (document.referrer) {
      try { data.landing_referrer = new URL(document.referrer).origin; } catch {}
    }
    if (partial) data._partial = "1";
    if (resume) {
      data._submission = resume.submission;
      data._resume = resume.token;
    }
    const response = await fetch(endpoint, {
      method: "POST", credentials: "omit",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data),
      keepalive: partial
    });
    const result = await response.json().catch(() => ({}));
    return { response, result, data };
  }

  function reportPartialOnce() {
    if (partialReported) return;
    partialReported = true;
    const value = name => form.elements.namedItem(name).value;
    // Measurement only; a failure is retried on the next pass, never shown.
    reportMetaEvent("LeadPartial", value("email"), value("telefonszam"))
      .catch(() => { partialReported = false; });
  }

  function sessionsChanged(result) {
    if (!Array.isArray(result.webinar_sessions)) return false;
    displaySessions({ ...session, webinar_sessions: result.webinar_sessions });
    showStep(0);
    return true;
  }

  function savePartial() {
    const run = queue.then(async () => {
      const { response, result } = await postToCrm(true);
      if (response.ok && result.ok) {
        if (result.submission && result.resume) {
          resume = { submission: String(result.submission), token: String(result.resume) };
        }
        return;
      }
      if (response.status === 403) {
        resume = null;
        displaySessions(await loadSession());
      } else if (sessionsChanged(result)) {
        showError(result.error || "A választott időpont már nem elérhető. Kérjük, válasszon újat.");
      }
    });
    // A failed save is not shown here: the final submission reports problems.
    queue = run.catch(() => {});
  }

  async function finish() {
    busy = true;
    next.disabled = true;
    back.disabled = true;
    nextText.textContent = "Jelentkezés küldése…";
    errorBox.hidden = true;
    try {
      await queue;
      const choice = new FormData(form).get(session.webinar_selection.field_key);
      const chosen = session.webinar_sessions.find(option => option.id === choice);
      if (!chosen) {
        showStep(0);
        throw new Error("Kérjük, válasszon időpontot.");
      }
      const date = new Date(chosen.scheduled_at);
      const { response, result, data } = await postToCrm(false);
      if (!response.ok || !result.ok) {
        if (response.status === 403) {
          resume = null;
          displaySessions(await loadSession());
          throw new Error("Frissítettük az űrlapot. Kérjük, néhány másodperc múlva küldje el újra.");
        }
        sessionsChanged(result);
        throw new Error(result.error || "Nem sikerült a regisztráció. Kérjük, ellenőrizze a megadott adatokat.");
      }
      resume = null;
      document.getElementById("valasztott-idopont").textContent =
        isoDay.format(date).slice(0, 4) + ". " + dateFormat.format(date) + ", " + timeFormat.format(date);
      form.hidden = true;
      form.reset();
      fallback.hidden = true;
      document.querySelector(".card-intro").hidden = true;
      success.hidden = false;
      success.focus({ preventScroll: true });
      // 201 = completed registration; honeypot hits get 200 and are not measured.
      if (response.status === 201) {
        // An unavailable measurement service must not interrupt a registration.
        reportMetaEvent("Lead", data.email, data.telefonszam).catch(() => {});
      }
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: "webinar_registration", webinar: "kreativo-" + isoDay.format(date),
        webinar_session_id: chosen.id, webinar_scheduled_at: chosen.scheduled_at
      });
    } catch (error) {
      showError(error instanceof TypeError ? "Kapcsolati hiba történt. Ha nem kapott visszaigazolást, próbálja újra, vagy nyissa meg a külön regisztrációs űrlapot." : error.message);
    } finally {
      busy = false;
      next.disabled = false;
      updateNav();
    }
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    fallback.hidden = false;
  }

  form.addEventListener("input", (event) => {
    if (typeof event.target.setCustomValidity === "function") event.target.setCustomValidity("");
    errorBox.hidden = true;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy || !validateStep(current)) return;
    errorBox.hidden = true;
    if (current === steps.length - 1) {
      finish();
      return;
    }
    if (current + 1 === PARTIAL_AFTER_STEP) reportPartialOnce();
    if (current + 1 >= PARTIAL_AFTER_STEP) savePartial();
    showStep(current + 1);
  });
  back.addEventListener("click", () => {
    if (busy || current === 0) return;
    errorBox.hidden = true;
    showStep(current - 1);
  });

  // Until the CRM confirms it is ready, visitors can use the hosted form.
  loadSession().then((value) => {
    displaySessions(value);
    showStep(0, false);
    form.hidden = false;
    fallback.hidden = true;
  }).catch(error => showError(error instanceof TypeError ? "Az űrlap most nem töltődött be. Az alábbi linken tud jelentkezni." : error.message));
})();
