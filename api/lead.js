import crypto from "node:crypto";
import nodemailer from "nodemailer";

// Egyetlen lead capture endpoint — full + partial submit egyaránt ide érkezik.
// Három kimenő csatorna: n8n webhook (blocking, source of truth),
// Meta CAPI és e-mail értesítés (mindkettő non-blocking, silent fail).

const FB_API_VERSION = "v19.0";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value).trim().toLowerCase())
    .digest("hex");
}

function hashPhone(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return crypto.createHash("sha256").update(digits).digest("hex");
}

function isString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isValidPhone(v) {
  const digits = String(v || "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function isValidTaxNumber(v) {
  // Magyar adószám: 11 számjegy (kötőjeles formátum is elfogadott).
  const digits = String(v || "").replace(/\D/g, "");
  return digits.length === 11;
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.socket?.remoteAddress || "";
}

function parseFbCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  String(cookieHeader)
    .split(";")
    .forEach((part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k === "_fbp") out.fbp = v;
      if (k === "_fbc") out.fbc = v;
    });
  return out;
}

async function sendCapiEvent({ eventName, eventId, eventSourceUrl, userData, customData }) {
  const PIXEL_ID = process.env.FB_PIXEL_ID;
  const TOKEN = process.env.FB_CAPI_TOKEN;
  if (!PIXEL_ID || !TOKEN) {
    console.warn("[lead] CAPI kihagyva — FB_PIXEL_ID / FB_CAPI_TOKEN nincs beállítva");
    return { ok: false, error: "not_configured" };
  }

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_source_url: eventSourceUrl,
        ...(eventId && { event_id: eventId }),
        user_data: userData,
        custom_data: customData,
      },
    ],
  };
  if (process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = String(process.env.META_TEST_EVENT_CODE);
  }

  const url = `https://graph.facebook.com/${FB_API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("[lead] CAPI hiba", JSON.stringify(data));
      return { ok: false, error: data };
    }
    return { ok: true };
  } catch (err) {
    console.error("[lead] CAPI kivétel", String(err));
    return { ok: false, error: String(err) };
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildLeadEmail(body, { ip, beerkezett, contentName, isDirektLead }) {
  const nev = `${body.vezeteknev.trim()} ${body.keresztnev.trim()}`.trim();
  const leadLabel = isDirektLead ? "Direkt érdeklődő" : "Új lead";
  const subject = `${leadLabel} — ${contentName}: ${nev}`;

  const rows = [
    ["Típus", contentName],
    ["Lead jellege", isDirektLead ? "Direkt érdeklődő" : "Ebook letöltő"],
    ["Név", nev],
    ["E-mail", body.email.trim()],
    ["Telefonszám", body.telefonszam.trim()],
    ["Cégnév", body.cegnev.trim()],
    ["Adószám", isString(body.adoszam) ? body.adoszam.trim() : "—"],
  ];
  if (isString(body.palyazati_konstrukcio)) {
    rows.push(["Pályázati konstrukció", body.palyazati_konstrukcio.trim()]);
  }
  if (isString(body.megvalositasi_helyszin)) {
    rows.push(["Megvalósítási helyszín", body.megvalositasi_helyszin.trim()]);
  }
  rows.push(["Megjegyzés", isString(body.megjegyzes) ? body.megjegyzes.trim() : "—"]);
  rows.push(["Forrás", body.forras || "—"]);
  rows.push(["Beérkezett", beerkezett]);
  rows.push(["IP", ip || "—"]);

  const text =
    `${leadLabel.toUpperCase()} — ${contentName}\n\n` + rows.map(([k, v]) => `${k}: ${v}`).join("\n");

  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1b2e;">` +
    `<h2 style="margin:0 0 4px;">${escapeHtml(leadLabel)} — ${escapeHtml(contentName)}</h2>` +
    `<p style="margin:0 0 16px;color:#666;">${escapeHtml(body.forras || "landing oldal")}</p>` +
    `<table style="border-collapse:collapse;width:100%;max-width:560px;">` +
    rows
      .map(
        ([k, v]) =>
          `<tr>` +
          `<td style="padding:6px 12px;border:1px solid #e5e3dd;background:#faf8f3;font-weight:bold;white-space:nowrap;">${escapeHtml(k)}</td>` +
          `<td style="padding:6px 12px;border:1px solid #e5e3dd;">${escapeHtml(v)}</td>` +
          `</tr>`,
      )
      .join("") +
    `</table></div>`;

  return { subject, text, html };
}

// E-mail értesítés a teljes leadekről — non-blocking, silent fail (mint a CAPI).
// Részleges (partial) leadről soha nem megy e-mail; az csak az n8n-hez és a
// CAPI-hoz jut el.
// Címzettek: LEAD_EMAIL_TO env; ha üres, prodban info@kreativo.hu + zalan@…,
// egyébként csak zalan@traininghungary.com (teszt).
async function sendLeadEmail({ body, ip, beerkezett, contentName, isDirektLead }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn("[lead] e-mail kihagyva — SMTP_HOST / SMTP_USER / SMTP_PASS nincs beállítva");
    return { ok: false, error: "not_configured" };
  }

  const from = process.env.LEAD_EMAIL_FROM || "info@kreativo.hu";
  const to =
    process.env.LEAD_EMAIL_TO ||
    (process.env.NODE_ENV === "production"
      ? "info@kreativo.hu,zalan@traininghungary.com"
      : "zalan@traininghungary.com");

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    const { subject, text, html } = buildLeadEmail(body, {
      ip,
      beerkezett,
      contentName,
      isDirektLead,
    });
    await transporter.sendMail({
      from,
      to,
      replyTo: body.email.trim(),
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (err) {
    console.error("[lead] e-mail kivétel", String(err));
    return { ok: false, error: String(err) };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Érvénytelen JSON törzs." });
    }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Érvénytelen JSON törzs." });
  }

  const partial = body.partial === true;

  // Landing-specifikus címkék — alapértelmezés a Pályázati Kisokos ebook landing,
  // de bármely landing felülírhatja a lead_type / content_name mezőkkel.
  const leadType = isString(body.lead_type) ? body.lead_type.trim() : "ebook";
  const contentName = isString(body.content_name) ? body.content_name.trim() : "Pályázati Kisokos";

  // A sikerdíjas pályázatírás landing direkt érdeklődői külön n8n csatornára
  // mennek (DirektLead webhook), hogy ne keveredjenek az ebook leadekkel.
  const isDirektLead = leadType === "sikerdijas-palyazatiras";

  // Validáció — a partial save a cégnév lépcső után fut, így a név/e-mail/
  // telefon/cégnév mindig kötelező; az adószám csak a teljes submitnél;
  // a megjegyzés végig opcionális.
  if (
    !isString(body.vezeteknev) ||
    !isString(body.keresztnev) ||
    !isString(body.email) ||
    !isString(body.telefonszam) ||
    !isString(body.cegnev)
  ) {
    return res.status(422).json({ error: "Hiányzó kötelező mező." });
  }
  if (!EMAIL.test(body.email.trim())) {
    return res.status(422).json({ error: "Érvénytelen e-mail cím." });
  }
  if (!isValidPhone(body.telefonszam)) {
    return res.status(422).json({ error: "Érvénytelen telefonszám." });
  }
  if (!partial) {
    if (!isString(body.adoszam)) {
      return res.status(422).json({ error: "Hiányzó kötelező mező." });
    }
    if (!isValidTaxNumber(body.adoszam)) {
      return res.status(422).json({ error: "Érvénytelen adószám." });
    }
  }

  // Szerveroldali enrichment.
  const ip = getClientIp(req);
  const userAgent = req.headers["user-agent"] || "";
  const { fbp, fbc } = parseFbCookies(req.headers.cookie);
  const beerkezett = isString(body.beerkezett) ? body.beerkezett : new Date().toISOString();
  const attribution =
    body.attribution && typeof body.attribution === "object" ? body.attribution : {};
  const eventSourceUrl = isString(body.event_source_url)
    ? body.event_source_url
    : isString(attribution.page_url)
      ? attribution.page_url
      : isString(body.forras)
        ? body.forras
        : "";

  // ── Meta CAPI — non-blocking, silent fail ──
  // _fbc rekonstrukció: ha nincs cookie, de van fbclid, az attribúcióból építjük fel.
  const fbcFinal =
    fbc ||
    (attribution.fbclid
      ? `fb.1.${attribution.captured_at || Date.now()}.${attribution.fbclid}`
      : undefined);

  const userData = {
    em: [sha256(body.email)],
    ph: [hashPhone(body.telefonszam)],
    fn: [sha256(body.keresztnev)],
    ln: [sha256(body.vezeteknev)],
    client_user_agent: userAgent,
    ...(ip && { client_ip_address: ip }),
    ...(fbp && { fbp }),
    ...(fbcFinal && { fbc: fbcFinal }),
  };

  const customData = {
    content_name: contentName,
    lead_source: body.forras || "",
    company: isString(body.cegnev) ? body.cegnev.trim() : "",
    tax_number: isString(body.adoszam) ? body.adoszam.trim() : "",
    grant_scheme: isString(body.palyazati_konstrukcio) ? body.palyazati_konstrukcio.trim() : "",
    project_location: isString(body.megvalositasi_helyszin)
      ? body.megvalositasi_helyszin.trim()
      : "",
    partial,
    utm_source: attribution.utm_source || "",
    utm_medium: attribution.utm_medium || "",
    utm_campaign: attribution.utm_campaign || "",
    utm_content: attribution.utm_content || "",
    utm_term: attribution.utm_term || "",
    utm_id: attribution.utm_id || "",
    fbclid: attribution.fbclid || "",
    gclid: attribution.gclid || "",
    msclkid: attribution.msclkid || "",
    ttclid: attribution.ttclid || "",
    li_fat_id: attribution.li_fat_id || "",
    landing_url: attribution.landing_url || "",
    landing_referrer: attribution.landing_referrer || "",
    page_url: attribution.page_url || "",
    page_path: attribution.page_path || "",
    page_referrer: attribution.page_referrer || "",
  };

  const capiPromise = sendCapiEvent({
    eventName: partial ? "LeadPartial" : "Lead",
    eventId: isString(body.event_id) ? body.event_id : undefined,
    eventSourceUrl,
    userData,
    customData,
  }).catch((err) => {
    console.error("[lead] CAPI promise elutasítva", String(err));
    return { ok: false, error: String(err) };
  });

  // ── E-mail értesítés — CSAK teljes submitnél, non-blocking, silent fail ──
  // Részleges leadről szándékosan nem megy e-mail; az csak az n8n-hez és a
  // CAPI-hoz jut el.
  const emailPromise = partial
    ? Promise.resolve({ ok: false, skipped: "partial" })
    : sendLeadEmail({ body, ip, beerkezett, contentName, isDirektLead }).catch((err) => {
        console.error("[lead] e-mail promise elutasítva", String(err));
        return { ok: false, error: String(err) };
      });

  // A háttérhívásokat minden visszatérési ág előtt bevárjuk, hogy a serverless
  // function ne álljon le, mielőtt a CAPI / e-mail ténylegesen kiszáll.
  const sideChannels = () => Promise.all([capiPromise, emailPromise]);

  // ── n8n webhook — blocking, source of truth ──
  // A direkt érdeklődők (sikerdíjas pályázatírás landing) a DirektLead
  // webhookra mennek, minden más lead az ebook webhookra.
  const N8N_URL = isDirektLead
    ? process.env.N8N_DIREKTLEAD_WEBHOOK_URL
    : process.env.N8N_EBOOK_WEBHOOK_URL;
  const N8N_SECRET = isDirektLead
    ? process.env.N8N_DIREKTLEAD_WEBHOOK_SECRET
    : process.env.N8N_EBOOK_WEBHOOK_SECRET;

  if (!N8N_URL) {
    await sideChannels();
    if (process.env.NODE_ENV !== "production") {
      console.warn("[lead] n8n webhook URL nincs beállítva — devMode válasz");
      return res.status(200).json({ ok: true, devMode: true });
    }
    return res.status(503).json({ error: "A leadrögzítés most nem elérhető." });
  }

  const n8nBody = {
    vezeteknev: body.vezeteknev.trim(),
    keresztnev: body.keresztnev.trim(),
    cegnev: body.cegnev.trim(),
    email: body.email.trim(),
    telefonszam: body.telefonszam.trim(),
    adoszam: isString(body.adoszam) ? body.adoszam.trim() : "",
    palyazati_konstrukcio: isString(body.palyazati_konstrukcio)
      ? body.palyazati_konstrukcio.trim()
      : "",
    megvalositasi_helyszin: isString(body.megvalositasi_helyszin)
      ? body.megvalositasi_helyszin.trim()
      : "",
    megjegyzes: isString(body.megjegyzes) ? body.megjegyzes.trim() : "",
    partial,
    lead_type: leadType,
    forras: body.forras || "",
    beerkezett,
    event_id: isString(body.event_id) ? body.event_id : "",
    ip,
    userAgent,
    attribution,
  };

  try {
    const n8nResp = await fetch(N8N_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(N8N_SECRET && { Authorization: `Bearer ${N8N_SECRET}` }),
      },
      body: JSON.stringify(n8nBody),
      signal: AbortSignal.timeout(9000),
    });
    if (!n8nResp.ok) {
      await sideChannels();
      return res
        .status(502)
        .json({ error: "A beküldés most nem sikerült. Próbáld pár perc múlva." });
    }
  } catch (err) {
    console.error("[lead] n8n kivétel", String(err));
    await sideChannels();
    return res.status(502).json({ error: "Hálózati hiba történt. Próbáld újra." });
  }

  await sideChannels();
  return res.status(200).json({ ok: true });
}
