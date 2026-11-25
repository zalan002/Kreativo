(() => {
  "use strict";
  const crmOrigin = "https://partnercrm.leadgensolution.hu";
  const key = "28e9d9f97b166b213f6693213b921780";
  const endpoint = crmOrigin + "/api/public/forms/" + key;
  const form = document.getElementById("webinar-form");
  const errorBox = document.getElementById("form-error");
  const fallback = document.getElementById("direct-form");
  const success = document.getElementById("siker");
  const submit = form.querySelector('button[type="submit"]');
  const submitText = submit.querySelector("span");
  const submitLabel = submitText.textContent;
  const campaign = new URLSearchParams();
  const query = new URLSearchParams(location.search);
  for (const name of ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id","fbclid","gclid","msclkid","ttclid","li_fat_id"]) {
    if (query.get(name)) campaign.set(name, query.get(name));
  }
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

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    fallback.hidden = false;
  }

  form.addEventListener("input", (event) => {
    if (typeof event.target.setCustomValidity === "function") event.target.setCustomValidity("");
    errorBox.hidden = true;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const phone = form.elements.namedItem("telefonszam");
    const tax = form.elements.namedItem("adoszam");
    const phoneLength = phone.value.replace(/\D/g, "").length;
    const taxLength = tax.value.replace(/\D/g, "").length;
    phone.setCustomValidity(phoneLength < 7 || phoneLength > 15 ? "A telefonszám 7–15 számjegyet tartalmazhat." : "");
    tax.setCustomValidity(tax.value.trim() && taxLength !== 11 ? "Az adószám 11 számjegyből áll." : "");
    if (!form.reportValidity()) return;
    busy = true;
    submit.disabled = true;
    submitText.textContent = "Jelentkezés küldése…";
    errorBox.hidden = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      const chosen = session.webinar_sessions.find(option => option.id === data[session.webinar_selection.field_key]);
      if (!chosen) throw new Error("Kérjük, válasszon időpontot.");
      const date = new Date(chosen.scheduled_at);
      Object.assign(data, Object.fromEntries(campaign), {
        _token: session.token, _ts: session.ts, _channel: "embed",
        landing_url: landingUrl.href, page_url: landingUrl.href
      });
      if (document.referrer) {
        try { data.landing_referrer = new URL(document.referrer).origin; } catch {}
      }
      const response = await fetch(endpoint, {
        method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data)
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        if (response.status === 403) {
          displaySessions(await loadSession());
          throw new Error("Frissítettük az űrlapot. Kérjük, néhány másodperc múlva küldje el újra.");
        }
        if (Array.isArray(result.webinar_sessions)) {
          displaySessions({ ...session, webinar_sessions: result.webinar_sessions });
        }
        throw new Error(result.error || "Nem sikerült a regisztráció. Kérjük, ellenőrizze a megadott adatokat.");
      }
      document.getElementById("valasztott-idopont").textContent =
        isoDay.format(date).slice(0, 4) + ". " + dateFormat.format(date) + ", " + timeFormat.format(date);
      form.hidden = true;
      form.reset();
      fallback.hidden = true;
      document.querySelector(".card-intro").hidden = true;
      success.hidden = false;
      success.focus({ preventScroll: true });
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: "webinar_registration", webinar: "kreativo-" + isoDay.format(date),
        webinar_session_id: chosen.id, webinar_scheduled_at: chosen.scheduled_at
      });
    } catch (error) {
      showError(error instanceof TypeError ? "Kapcsolati hiba történt. Ha nem kapott visszaigazolást, próbálja újra, vagy nyissa meg a külön regisztrációs űrlapot." : error.message);
    } finally {
      busy = false;
      submit.disabled = false;
      submitText.textContent = submitLabel;
    }
  });

  // Until the CRM confirms it is ready, visitors can use the hosted form.
  loadSession().then((value) => {
    displaySessions(value);
    form.hidden = false;
    fallback.hidden = true;
  }).catch(error => showError(error instanceof TypeError ? "Az űrlap most nem töltődött be. Az alábbi linken tud jelentkezni." : error.message));
})();
