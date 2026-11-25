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
  let session;
  let busy = false;

  async function loadSession() {
    const response = await fetch(endpoint, { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw new Error("Az űrlap jelenleg nem érhető el.");
    const data = await response.json();
    if (!data.token || !data.ts) throw new Error("A regisztrációt nem sikerült előkészíteni.");
    return data;
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
          session = await loadSession();
          throw new Error("Frissítettük az űrlapot. Kérjük, néhány másodperc múlva küldje el újra.");
        }
        throw new Error(result.error || "Nem sikerült a regisztráció. Kérjük, ellenőrizze a megadott adatokat.");
      }
      form.hidden = true;
      form.reset();
      fallback.hidden = true;
      document.querySelector(".card-intro").hidden = true;
      success.hidden = false;
      success.focus({ preventScroll: true });
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({event:"webinar_registration", webinar:"kreativo-2026-12-08"});
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
    session = value;
    form.hidden = false;
    fallback.hidden = true;
  }).catch(() => showError("A beágyazott űrlap most nem töltődött be. Az alábbi linken tud jelentkezni."));
})();
