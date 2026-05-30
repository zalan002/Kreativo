# Backend & Meta-mérés reprodukciós dokumentum

> Cél: ez a dokumentum önmagában elegendő ahhoz, hogy a Kreativo oldal **háttér-működése**
> (lead-feldolgozás, n8n integráció, Meta Pixel + Conversions API mérés, e-mail értesítés,
> attribúció) **egy másik oldalon is azonosan reprodukálható** legyen.
> A dokumentum **csak a háttérrel** foglalkozik — az oldal tematikája, szövegezése és
> dizájnja nem része. Ahol szükséges, a forrásfájlban lévő pontos kódot is közöljük,
> az oldal-specifikus értékeket pedig `<PLACEHOLDER>` jelöléssel emeljük ki.

---

## 0. TL;DR — mi a rendszer lényege

A rendszer egy **statikus HTML oldal** (Vercel hosting), amely mögött **két serverless
függvény** fut, és **három kimenő integrációs csatorna** van:

1. **n8n webhook** — *blocking, source of truth*. Ide kerül minden lead.
2. **Meta Conversions API (CAPI)** — *non-blocking, silent fail*. Szerveroldali mérés.
3. **E-mail értesítés** (SMTP / nodemailer) — *non-blocking, silent fail*. Csak teljes leadről.

Kétféle űrlap-architektúra létezik:

| Űrlaptípus | Hol | Hova küld | Mér CAPI-t? |
|---|---|---|---|
| **Multi-step landing form** | lead-magnet landingek | böngésző → `/api/lead` → n8n + CAPI + e-mail | igen (`LeadPartial`, ill. köszönőoldal `Lead`) |
| **Egyszerű kapcsolati form** | minden más oldal | böngésző → **közvetlenül** n8n webhook | csak a köszönőoldalon (`Lead`) |

A **konverziós `Lead` esemény mindig a köszönőoldalon tüzel** (Pixel + CAPI, közös
`event_id`-vel deduplikálva), függetlenül attól, melyik űrlapról érkezett a lead.

---

## 1. Tech stack és projektstruktúra

| Réteg | Technológia |
|---|---|
| Hosting | **Vercel** (statikus fájlok + serverless functions) |
| Serverless runtime | **Node.js** (ESM — `"type": "module"`) |
| E-mail | **nodemailer** `^6.9` (a lock szerint 6.10.1) |
| Mérés | **Meta Pixel** (kliens) + **Meta Conversions API** (szerver), `graph.facebook.com/v19.0` |
| Lead-routing | **n8n** (felhős, `*.app.n8n.cloud`) |
| Build | nincs build lépés — natív statikus HTML + két API fájl |

Releváns fájlok / mappák:

```
/
├── api/
│   ├── lead.js          ← fő lead-capture endpoint (n8n + CAPI + e-mail)
│   └── capi.js          ← önálló CAPI proxy (ViewContent + Lead esemény továbbítás)
├── package.json         ← { "type": "module", deps: { nodemailer } }
├── vercel.json          ← { "cleanUrls": true, "trailingSlash": false }
├── .vercelignore        ← docs/ kizárva a deployból
├── .env.example         ← az összes szerveroldali env változó sablonja
└── *.html               ← oldalak; a Pixel/CAPI/attribúció/form JS inline a HTML-ekben
```

> **Fontos:** a kliensoldali JS (Pixel base, CAPI helper, attribúció, multi-step form) **nem
> külön `.js` fájl**, hanem inline `<script>` blokk minden releváns HTML `<head>`-jében és
> az űrlap alatt. Reprodukcióhoz ezeket a snippeteket kell átemelni (lásd lentebb).

### `vercel.json` és `cleanUrls`

```json
{ "cleanUrls": true, "trailingSlash": false }
```

A `cleanUrls` miatt a HTML-ek `.html` kiterjesztés nélkül érhetők el (`/kapcsolat`,
`/koszonjuk-az-erdeklodest`), és a `.html`-es URL 308-cal a tiszta változatra redirektel.
Minden belső link és form-redirect root-relatív, kiterjesztés nélküli.

### `package.json`

```json
{
  "name": "kreativo",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": { "nodemailer": "^6.9.0" }
}
```

---

## 2. Környezeti változók (teljes lista)

Ezeket a Vercel projekt **Settings → Environment Variables** alatt kell beállítani
(Production / Preview / Development scope). **Soha ne kerüljenek git-be.** A `.env.example`
a sablon — éles értéket nem tartalmaz.

| Név | Titkos? | Kötelező? | Leírás |
|---|---|---|---|
| `FB_PIXEL_ID` | nem | igen (méréshez) | Meta Pixel ID. A böngészőben is látható. |
| `FB_CAPI_TOKEN` | **IGEN** | igen (CAPI-hoz) | Conversions API access token. Csak szerver oldalon. |
| `META_TEST_EVENT_CODE` | nem | nem | Events Manager → Test Events kód. **Prodban ÜRESEN** (különben nem konverzió). |
| `N8N_EBOOK_WEBHOOK_URL` | nem | igen (ebook landinghoz) | Ebook/egyéb leadek n8n webhook URL-je. Ha nincs: prodban a `/api/lead` 503-at ad, devben devMode válasz. |
| `N8N_EBOOK_WEBHOOK_SECRET` | igen | nem | Ha be van állítva, `Authorization: Bearer <secret>` headerrel megy az n8n felé. |
| `N8N_DIREKTLEAD_WEBHOOK_URL` | nem | igen (sikerdíjas landinghoz) | A direkt érdeklődők külön n8n csatornája. |
| `N8N_DIREKTLEAD_WEBHOOK_SECRET` | igen | nem | Mint fent, a DirektLead csatornához. |
| `SMTP_HOST` | nem | igen (e-mailhez) | Pl. `smtp.mandrillapp.com`. |
| `SMTP_PORT` | nem | nem (def. 587) | 587 → STARTTLS; 465 → `secure: true`. |
| `SMTP_USER` | nem | igen (e-mailhez) | SMTP felhasználónév. |
| `SMTP_PASS` | **IGEN** | igen (e-mailhez) | SMTP jelszó / API kulcs. |
| `LEAD_EMAIL_FROM` | nem | nem | Feladó cím (def. `info@kreativo.hu`). Visszaigazolt domain ajánlott. |
| `LEAD_EMAIL_TO` | nem | nem | Címzettek vesszővel. Üresen: prod → `info@…,zalan@…`, egyébként → `zalan@…`. |
| `NODE_ENV` | — | — | Vercel állítja automatikusan (`production` éles deploynál). Vezérli a fallback viselkedést. |

> **Routing-szabály:** a `lead_type === "sikerdijas-palyazatiras"` esetén a `DIREKTLEAD`
> webhook + secret, **minden más** esetben az `EBOOK` webhook + secret aktív.

> **Production vs. teszt n8n:** az n8n felhőben az „aktivált” workflow a `/webhook/<id>`
> útvonalon hallgat, a szerkesztés alatti teszt a `/webhook-test/<id>` útvonalon. A Vercel
> Production scope-ban a `/webhook/...`, a Preview scope-ban a `/webhook-test/...` URL-t
> érdemes beállítani ugyanahhoz a változóhoz.

---

## 3. `/api/lead.js` — a központi lead-capture endpoint

Ez a multi-step landing formok egyetlen belépési pontja. Teljes (`partial: false`) és
részleges (`partial: true`) submitnél egyaránt ide érkezik a POST.

### 3.1 Magas szintű folyamat

```
POST /api/lead  (JSON)
  │
  ├─ 1. metódus-ellenőrzés (csak POST, különben 405)
  ├─ 2. JSON parse (hibás → 400)
  ├─ 3. lead_type / content_name meghatározása → isDirektLead?
  ├─ 4. validáció (hiányzó mező / e-mail / telefon / adószám → 422)
  ├─ 5. szerveroldali enrichment (IP, UA, _fbp/_fbc cookie, event_source_url)
  │
  ├─ 6. CAPI esemény előkészítés (Promise, NEM blokkol):
  │       partial=true  → LeadPartial elküldése
  │       partial=false → kihagyva (a Lead a köszönőoldalon tüzel)
  │
  ├─ 7. E-mail értesítés előkészítés (Promise, NEM blokkol):
  │       partial=true  → kihagyva
  │       partial=false → értesítő e-mail
  │
  └─ 8. n8n webhook hívás (BLOCKING, source of truth):
          URL/secret a lead_type szerint (EBOOK vs DIREKTLEAD)
          nincs URL  → sideChannels bevárása, majd 503 (devben 200 devMode)
          non-2xx    → sideChannels bevárása, majd 502
          timeout    → sideChannels bevárása, majd 502
          siker      → sideChannels bevárása, majd 200 { ok: true }
```

A „sideChannels” (CAPI + e-mail) `Promise`-ok **minden visszatérési ág előtt be vannak
várva** (`await Promise.all([...])`), hogy a serverless függvény ne álljon le, mielőtt a
háttérhívások ténylegesen kiszállnak.

### 3.2 Validációs szabályok

- **Mindig kötelező:** `vezeteknev`, `keresztnev`, `email`, `telefonszam`, `cegnev`
  (a partial save a cégnév-lépcső után fut, ezért ezek ott már megvannak).
- **E-mail:** `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.
- **Telefon:** csak a számjegyek számítanak, **7–15 számjegy** közöttinek kell lennie.
- **Adószám (opcionális):** ha megadták, **pontosan 11 számjegy** (kötőjeles formátum is OK).
- **Opcionális, validáció nélküli:** `palyazati_konstrukcio`, `megvalositasi_helyszin`,
  `megjegyzes` (ezeket a sikerdíjas landing küldi).

### 3.3 Bemenő payload (kliens → `/api/lead`)

```jsonc
{
  "vezeteknev": "Kovács",
  "keresztnev": "János",
  "cegnev": "Példa Kft.",
  "email": "kovacs@ceg.hu",
  "telefonszam": "+36 30 123 4567",
  "adoszam": "12345678-1-23",          // opcionális
  "palyazati_konstrukcio": "GINOP...", // csak sikerdíjas landing
  "megvalositasi_helyszin": "Budapest",// csak sikerdíjas landing
  "megjegyzes": "...",                 // opcionális
  "partial": false,                    // true = részleges mentés
  "lead_type": "ebook",                // vagy "sikerdijas-palyazatiras"
  "content_name": "Pályázati Kisokos",
  "forras": "palyazati-kisokos",       // partialnál "...-partial"
  "event_id": "uuid-v4",               // teljesnél a köszönőoldallal közös; partialnál külön
  "event_source_url": "https://.../palyazati-kisokos",
  "beerkezett": "2026-05-30T10:00:00.000Z",
  "attribution": { /* lásd 6.5 */ }
}
```

### 3.4 Szerveroldali enrichment

```js
// Kliens IP: X-Forwarded-For első eleme, fallback socket.remoteAddress
function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.socket?.remoteAddress || "";
}

// _fbp / _fbc kiolvasása a Cookie headerből
function parseFbCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  String(cookieHeader).split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === "_fbp") out.fbp = v;
    if (k === "_fbc") out.fbc = v;
  });
  return out;
}
```

A `User-Agent` a `req.headers["user-agent"]`-ből jön, a `beerkezett` a bodyból (vagy
`new Date().toISOString()`), az `event_source_url` pedig sorrendben: body.`event_source_url`
→ `attribution.page_url` → body.`forras`.

### 3.5 Kimenő n8n payload (`/api/lead` → n8n)

```jsonc
{
  "vezeteknev": "...", "keresztnev": "...", "cegnev": "...",
  "email": "...", "telefonszam": "...", "adoszam": "",
  "palyazati_konstrukcio": "", "megvalositasi_helyszin": "", "megjegyzes": "",
  "partial": false,
  "lead_type": "ebook",
  "forras": "palyazati-kisokos",
  "beerkezett": "2026-05-30T10:00:00.000Z",
  "event_id": "uuid-v4",
  "ip": "1.2.3.4",
  "userAgent": "Mozilla/5.0 ...",
  "attribution": { /* teljes attribúciós objektum */ }
}
```

Hívás:

```js
await fetch(N8N_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(N8N_SECRET && { Authorization: `Bearer ${N8N_SECRET}` }),
  },
  body: JSON.stringify(n8nBody),
  signal: AbortSignal.timeout(9000),   // 9 mp timeout
});
```

### 3.6 HTTP válaszkódok

| Kód | Jelentés |
|---|---|
| 200 | Siker (`{ ok: true }`), vagy dev mode (`{ ok: true, devMode: true }`, ha nincs n8n URL és `NODE_ENV !== "production"`). |
| 400 | Érvénytelen JSON törzs. |
| 405 | Nem POST request. |
| 422 | Hiányzó kötelező mező / érvénytelen e-mail / telefon / adószám. |
| 502 | Az n8n webhook non-2xx-et adott, vagy hálózati hiba/timeout. |
| 503 | Prodban nincs a lead-típushoz tartozó n8n webhook URL beállítva. |

---

## 4. `/api/capi.js` — önálló Conversions API proxy

Ezt a kliens **közvetlenül** hívja a `ViewContent` (landing betöltés) és a `Lead`
(köszönőoldal) eseményeknél. A `/api/lead` belső CAPI-hívása (3.6 pontban a `LeadPartial`)
nem ezt használja, hanem saját `sendCapiEvent`-et — de a kettő payload-szerkezete azonos.

### 4.1 Működés

```
POST /api/capi (JSON)
  ├─ csak POST (különben 405)
  ├─ FB_PIXEL_ID / FB_CAPI_TOKEN hiányzik → 500
  ├─ event_name ∈ { "ViewContent", "Lead" }  (különben 400)
  ├─ user_data összeállítás:
  │     client_user_agent (mindig), client_ip_address (ha van)
  │     event_name === "Lead" esetén: em = sha256(email), ph = sha256(digits(phone))
  ├─ payload → POST https://graph.facebook.com/v19.0/<PIXEL_ID>/events?access_token=...
  └─ FB non-2xx → 502 (detail-lel), kivétel → 500, siker → 200 { ok, fb, event_id }
```

> **Megengedett események listája** (`ALLOWED_EVENTS`): csak `ViewContent` és `Lead`.
> Bármi más → 400. (A `LeadPartial` és `CompleteRegistration` nem ezen az endpointon megy:
> a `LeadPartial`-t a `/api/lead` küldi szerveroldalról, a `CompleteRegistration` pedig
> csak kliens Pixel esemény.)

### 4.2 Bemenő payload (kliens → `/api/capi`)

```jsonc
{
  "event_name": "Lead",                       // vagy "ViewContent"
  "event_id": "uuid-v4",                       // a dedup kulcsa
  "event_source_url": "https://.../koszonjuk-az-erdeklodest",
  "event_time": 1748600000,                    // unix sec; ha hiányzik, szerver tölti
  "email": "kovacs@ceg.hu",                    // csak Lead; szerver hash-eli
  "phone": "+36301234567",                     // csak Lead; szerver hash-eli
  "custom_data": { "content_name": "...", "content_category": "..." },
  "test_event_code": "TEST12345"               // opcionális, teszteléshez
}
```

### 4.3 Facebookhoz menő payload (mindkét endpoint közös szerkezete)

```jsonc
{
  "data": [
    {
      "event_name": "Lead",
      "event_time": 1748600000,
      "action_source": "website",
      "event_source_url": "https://.../koszonjuk-...",
      "event_id": "uuid-v4",
      "user_data": {
        "em": ["<sha256(email)>"],
        "ph": ["<sha256(digits(phone))>"],
        "fn": ["<sha256(keresztnev)>"],        // csak a /api/lead LeadPartial-nál
        "ln": ["<sha256(vezeteknev)>"],        // csak a /api/lead LeadPartial-nál
        "client_user_agent": "Mozilla/5.0 ...",
        "client_ip_address": "1.2.3.4",
        "fbp": "fb.1....",                      // ha van _fbp cookie
        "fbc": "fb.1....fbclid"                 // ha van _fbc cookie vagy fbclid
      },
      "custom_data": { /* ... */ }
    }
  ],
  "test_event_code": "TEST12345"               // csak ha META_TEST_EVENT_CODE be van állítva
}
```

---

## 5. n8n integráció

### 5.1 Három webhook-csatorna

| Csatorna | Honnan hívják | Env változó | Példa URL |
|---|---|---|---|
| **Közös kapcsolati** | böngésző → **közvetlenül** (nincs proxy) | *nincs — hardcode a HTML-ben* | `…/webhook/35919594-6d84-45ee-b920-fc1f8067cce0` |
| **Ebook / egyéb lead** | `/api/lead` (szerver) | `N8N_EBOOK_WEBHOOK_URL` | `…/webhook/<id>` |
| **DirektLead (sikerdíjas)** | `/api/lead` (szerver) | `N8N_DIREKTLEAD_WEBHOOK_URL` | `…/webhook/63b7d14f-041f-43f6-a1b5-11b05a257a3f` |

> **Miért külön?** A direkt érdeklődők (sikerdíjas landing) és az ebook-letöltők ne
> keveredjenek egy listában — ezért külön n8n workflow/webhook fogadja őket. A `lead_type`
> mező alapján a `/api/lead` automatikusan a megfelelő csatornára routol.

### 5.2 Közös kapcsolati webhook (egyszerű formok)

A nem-landing oldalak (kezdőlap, kapcsolat, szolgáltatás-aloldalak, referenciák,
pályázatfigyelés) **közvetlenül a böngészőből** POST-olnak az n8n-re — nincs serverless
proxy, nincs szerveroldali CAPI. A payload:

```jsonc
{
  "vezeteknev": "...", "keresztnev": "...", "cegnev": "...", "adoszam": "...",
  "email": "...", "telefonszam": "...",
  "palyazati_elkepzeles": "...",        // ezeknél a mezőnév palyazati_elkepzeles
  "forras": "https://kreativo.hu/...",  // a teljes oldal-URL
  "submitted_at": "2026-05-30T10:00:00.000Z"
}
```

A sikeres válasz (`response.ok`) után a kliens `sessionStorage`-be ír (lásd 6.6) és a
`/koszonjuk-a-kapcsolatfelvetelt` oldalra navigál.

### 5.3 Hitelesítés (opcionális Bearer secret)

Ha a `*_WEBHOOK_SECRET` env be van állítva, a `/api/lead` `Authorization: Bearer <secret>`
headert küld. Az n8n oldalon ezt a webhook node „Header Auth" hitelesítésével lehet
ellenőrizni. A közvetlen kapcsolati webhook **nem** használ secretet (mert a böngészőből
megy, ahol a secret amúgy is látszana).

### 5.4 Mit kell csinálnia az n8n workflow-nak (reprodukcióhoz)

Az n8n a **source of truth** — minden lead ide kerül. A minimális workflow:

1. **Webhook node** (`POST`, `Respond: Immediately` vagy `When Last Node Finishes`).
   - A `/api/lead` 9 mp-en belül választ vár; ha az n8n túl lassan felel, a Vercel 502-t ad
     a kliensnek (de a lead az n8n-be ekkor is megérkezhetett). Érdemes gyors választ adni.
2. (Opcionális) **Header Auth** a `Authorization: Bearer <secret>` ellenőrzésére.
3. **Adattárolás** — pl. Google Sheets / Airtable / CRM node, ahova a lead mezői kerülnek.
   - Érdemes a `partial` mezőre szűrni / jelölni (a partial = félbehagyott űrlap).
   - A `lead_type` / `forras` mezővel lehet szegmentálni.
4. (Opcionális) belső értesítés, automatikus válasz-e-mail stb.

> **Megjegyzés a duplikációról:** ugyanahhoz a leadhez érkezhet egy `partial: true` és egy
> `partial: false` rekord is (ha a user a cégnév-lépcső után még befejezi az űrlapot). A két
> rekord `event_id`-je **eltér** (a partial külön UUID-t kap). Az n8n-ben az
> e-mail/telefon alapján lehet összevezetni, ha kell.

---

## 6. Meta-mérés (Pixel + Conversions API)

Ez a dokumentum legkritikusabb része. A mérés **hibrid**: kliensoldali Pixel **és**
szerveroldali CAPI, **közös `event_id`-vel deduplikálva**. Így az adat akkor is megérkezik,
ha az ad-blocker / iOS tracking-korlát miatt a kliens Pixel kiesne.

### 6.1 Eseménytérkép

| Esemény | Mikor | Hol | Pixel | CAPI | Dedup |
|---|---|---|---|---|---|
| **PageView** | minden oldalbetöltés | minden oldal | ✅ | — | — |
| **ViewContent** | landing betöltés | `palyazati-kisokos`, `sikerdijas-palyazatiras` | ✅ | ✅ (`/api/capi`) | ✅ közös `event_id` |
| **LeadPartial** | a cégnév-lépcső után (partial save) | `/api/lead` → CAPI custom event | — | ✅ | csak CAPI |
| **Lead** | sikeres teljes beküldés után | **köszönőoldal** (Pixel + `/api/capi`) | ✅ | ✅ | ✅ közös `event_id` |
| **CompleteRegistration** | köszönőoldal megnyitása | `koszonjuk-az-erdeklodest` | ✅ | — | — |

> **Kulcsdöntés:** a `Lead` **nem** a landingon vagy a `/api/lead`-ben tüzel, hanem a
> **köszönőoldalon**. Ott konvertál jobban, és ott biztos, hogy a beküldés sikeres volt.
> A landing form a sikeres POST után a `sessionStorage`-be teszi az adatokat + `event_id`-t,
> majd átirányít a köszönőoldalra, amely kiolvassa és tüzeli a `Lead`-et (Pixel + CAPI).

### 6.2 Pixel base kód (minden oldal `<head>`)

```html
<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '<FB_PIXEL_ID>');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=<FB_PIXEL_ID>&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->
```

> A jelenlegi élő Pixel ID: `3511173002462631` (publikus, nem titkos). Másik oldalon cseréld
> a saját Pixel ID-ra **mindenhol** (base kód + `<noscript>` + `FB_PIXEL_ID` env).

### 6.3 CAPI helper + ViewContent (landingek `<head>`)

```html
<script>
window.kreativoCAPI = (function() {
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === "x" ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  function send(payload) {
    return fetch("/api/capi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function() {});
  }
  return { uuid: uuid, send: send };
})();

// ViewContent — page-load, Pixel + CAPI dedup közös event_id-vel
(function() {
  var eventId = window.kreativoCAPI.uuid();
  if (typeof fbq !== "undefined") {
    fbq("track", "ViewContent",
      { content_name: "<LANDING_NÉV> — landing" },
      { eventID: eventId }            // FIGYELEM: Pixelben "eventID" (nagy ID)
    );
  }
  window.kreativoCAPI.send({
    event_name: "ViewContent",
    event_id: eventId,                // CAPI-ban "event_id" (snake_case)
    event_source_url: window.location.href,
    event_time: Math.floor(Date.now() / 1000),
    custom_data: { content_name: "<LANDING_NÉV> — landing" }
  });
})();
</script>
```

> **Dedup-tipp:** a Pixel oldalon a kulcs neve `eventID`, a CAPI oldalon `event_id`. Mindkettő
> **ugyanaz az UUID**, és az `event_name` is azonos → a Meta egy eseménynek számolja.

### 6.4 SHA-256 hashelés (szerveroldal)

A CAPI-nak küldött PII-t a szerver hash-eli (a kliens sosem hash-el). Pontos
implementáció — **reprodukcióhoz bitre ezt kövesd**:

```js
import crypto from "node:crypto";

// E-mail, név: trim + lowercase, majd SHA-256 hex
function sha256(value) {
  return crypto.createHash("sha256")
    .update(String(value).trim().toLowerCase())
    .digest("hex");
}

// Telefon: csak a számjegyek maradnak, majd SHA-256 hex
function hashPhone(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return crypto.createHash("sha256").update(digits).digest("hex");
}
```

> **Fontos részlet a telefonnál:** az implementáció csak a nem-számjegyeket szűri ki
> (`\D` → ""), és a kapott számjegysort hash-eli — **nincs** külön E.164-normalizálás
> (országkód-kiegészítés, vezető nullák kezelése). Ha másik oldalon a Meta illesztési
> arányát javítani akarod, érdemes a telefonszámot előbb E.164-re hozni (pl. `+36…` →
> `36…`), de a *jelenlegi* viselkedés reprodukciójához a fenti kódot kell használni.

A `user_data`-ba kerülő mezők (`/api/lead` szerveroldali CAPI esetén):

```js
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
```

### 6.5 `_fbp` / `_fbc` kezelés és `_fbc` rekonstrukció

- `_fbp` és `_fbc` a böngésző sütijeiből jön (a Pixel állítja be őket). A szerver a
  `Cookie` headerből olvassa ki (lásd `parseFbCookies`, 3.4).
- Ha **nincs `_fbc` cookie**, de van `fbclid` az attribúcióban, a szerver **rekonstruálja**:

```js
const fbcFinal =
  fbc ||
  (attribution.fbclid
    ? `fb.1.${attribution.captured_at || Date.now()}.${attribution.fbclid}`
    : undefined);
```

A formátum: `fb.1.<timestamp_ms>.<fbclid>` — ez a Meta hivatalos `_fbc` formátuma.

### 6.6 sessionStorage „handoff" a köszönőoldalra

A landing/kapcsolati form sikeres beküldés után **nem** tüzeli a `Lead`-et, hanem
átadja az adatokat a köszönőoldalnak:

```js
// Landing / kapcsolati form, sikeres POST után:
sessionStorage.setItem("kreativo_lead", JSON.stringify({
  event_id: eventId,        // a teljes submithez generált, az n8n is ezt kapta
  email: state.email,
  phone: state.telefonszam,
  forras: FORRAS,
  content_name: "<CONTENT_NAME>",
  ts: Date.now()
}));
window.location.href = REDIRECT;   // pl. /koszonjuk-az-erdeklodest
```

A köszönőoldal kiolvassa, **azonnal törli** (hogy reloadnál ne tüzeljen újra), majd
tüzeli a `Lead`-et Pixel + CAPI párban:

```js
(function() {
  var raw;
  try { raw = sessionStorage.getItem("kreativo_lead"); } catch (_) { return; }
  if (!raw) return;
  var data;
  try { data = JSON.parse(raw); } catch (_) { return; }
  try { sessionStorage.removeItem("kreativo_lead"); } catch (_) {}   // azonnali törlés
  if (!data || !data.event_id) return;

  var fireLead = function() {
    if (typeof fbq !== "undefined") {
      fbq("track", "Lead",
        { content_name: data.content_name || document.title, content_category: data.forras || "" },
        { eventID: data.event_id });
    }
    fetch("/api/capi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_name: "Lead",
        event_id: data.event_id,
        event_source_url: data.forras || window.location.href,
        event_time: Math.floor(Date.now() / 1000),
        email: data.email,
        phone: data.phone,
        custom_data: {
          content_name: data.content_name || document.title,
          content_category: data.forras || ""
        }
      }),
      keepalive: true
    }).catch(function() {});
  };

  // ha az fbq még nem töltött be, max ~2 mp-ig (40×50ms) várunk rá
  if (typeof fbq !== "undefined") { fireLead(); }
  else {
    var tries = 0;
    var iv = setInterval(function() {
      tries++;
      if (typeof fbq !== "undefined" || tries > 40) { clearInterval(iv); fireLead(); }
    }, 50);
  }
})();
```

> Az ebook köszönőoldalon (`koszonjuk-az-erdeklodest`) ezen felül egy **`CompleteRegistration`**
> esemény is tüzel (csak Pixel), ugyanezzel a „várj az fbq-ra" mintával. A kapcsolati
> köszönőoldalon (`koszonjuk-a-kapcsolatfelvetelt`) **nincs** CompleteRegistration, csak Lead.

### 6.7 Attribúciós réteg (UTM / click-id capture)

A landingek egy önálló attribúciós IIFE-t futtatnak, ami a marketing-paramétereket
`localStorage`-be menti **30 napos TTL-lel, last-touch-wins** logikával, és a form
beküldésekor ezt csatolja a payloadhoz.

```html
<script>
window.kreativoAttribution = (function() {
  var KEY = "<EGYEDI_KULCS>";              // kisokos: kreativo_kisokos_attr; sikerdíjas: kreativo_sikerdij_attr
  var TTL = 30 * 24 * 60 * 60 * 1000;      // 30 nap ms-ben
  var PARAM_KEYS = [
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id",
    "fbclid", "gclid", "msclkid", "ttclid", "li_fat_id"
  ];

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (!rec || !rec.captured_at) return null;
      if (Date.now() - rec.captured_at > TTL) { localStorage.removeItem(KEY); return null; }
      return rec;
    } catch (_) { return null; }
  }
  function write(rec) { try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch (_) {} }

  function capture() {
    var sp;
    try { sp = new URLSearchParams(window.location.search); } catch (_) { return; }
    var found = {}, hasTracking = false;
    PARAM_KEYS.forEach(function(k) { var v = sp.get(k); if (v) { found[k] = v; hasTracking = true; } });
    var existing = read();
    var now = Date.now();
    var landingUrl = window.location.href;
    var ref = document.referrer || "";
    if (hasTracking) {
      // last-touch wins — új kattintás felülírja a régit
      var rec = { captured_at: now, landing_url: landingUrl, landing_referrer: ref };
      PARAM_KEYS.forEach(function(k) { rec[k] = found[k] || ""; });
      write(rec);
    } else if (existing) {
      if (!existing.landing_url) existing.landing_url = landingUrl;
      if (!existing.landing_referrer) existing.landing_referrer = ref;
      write(existing);
    } else {
      var first = { captured_at: now, landing_url: landingUrl, landing_referrer: ref };
      PARAM_KEYS.forEach(function(k) { first[k] = ""; });
      write(first);
    }
  }

  function payload() {
    var rec = read() || {};
    var out = {};
    PARAM_KEYS.forEach(function(k) { out[k] = rec[k] || ""; });
    out.landing_url = rec.landing_url || "";
    out.landing_referrer = rec.landing_referrer || "";
    out.page_url = window.location.href;
    out.page_path = window.location.pathname;
    out.page_referrer = document.referrer || "";
    out.captured_at = rec.captured_at || Date.now();
    return out;
  }

  capture();
  return { payload: payload };
})();
</script>
```

A `payload()` által visszaadott objektum bekerül a `/api/lead` body `attribution` mezőjébe,
és onnan az n8n + a CAPI `custom_data` is megkapja (utm_*, *clid, landing_url stb.).

---

## 7. Űrlapok

### 7.1 Multi-step landing form (`/api/lead`-re küld)

Jellemzők (mindkét landingon — ebook és sikerdíjas — azonos váz):

- **Lépésenként 1–2 mező**, kliensoldali validációval (`validate` callback mezőnként).
- A **teljes submit `event_id`-je a form betöltésekor egyszer generálódik**
  (`window.kreativoCAPI.uuid()`), és ez megy az n8n-be, a sessionStorage-be és a köszönőoldali
  `Lead`-be is → így a Pixel és a CAPI dedupol. Hibás beküldés utáni retry ugyanazt az
  `event_id`-t használja → nincs duplikált konverzió.
- **Partial save:** a `partialAfter: true` lépcső (a cégnév/cégadatok lépcső) sikeres
  validációja után egyszer, fire-and-forget módon POST-ol `partial: true`-val. Saját, külön
  `event_id`-t kap (nem dedupol a Lead-del). Hiba esetén a flag visszaáll → újrapróbálható.
- `buildBody(isPartial)` állítja össze a payloadot (lásd 3.3); partialnál a `forras` végére
  `-partial` kerül.
- Sikeres teljes submit → sessionStorage handoff (6.6) → redirect a köszönőoldalra.

Lépés-konfiguráció (példa, ebook landing):

| Lépés | Mező(k) | Validáció |
|---|---|---|
| 1 | vezeteknev, keresztnev | min. 2 karakter |
| 2 | email, telefonszam | e-mail regex; 7–15 számjegy |
| 3 *(partialAfter)* | cegnev | min. 2 karakter |
| 4 | adoszam | üres OK, vagy pontosan 11 számjegy |
| 5 | megjegyzes | nincs |

A sikerdíjas landing eltérése: a 3. lépcsőben cégnév **és** adószám együtt; plusz egy
„Mire pályázna?" lépcső (`palyazati_konstrukcio` opcionális + `megvalositasi_helyszin`
kötelező). A `buildBody` itt `lead_type: "sikerdijas-palyazatiras"` és
`content_name: "Sikerdíjas pályázatírás"` mezőket is küld.

### 7.2 Egyszerű kapcsolati form (közvetlen n8n)

A nem-landing oldalakon a form a böngészőből közvetlenül POST-ol a közös n8n webhookra
(lásd 5.2). Mezők: vezeteknev, keresztnev, cegnev, adoszam, email, telefonszam,
`palyazati_elkepzeles`, `forras` (= teljes URL), `submitted_at`. Kliensoldali validáció:
kötelező mezők + e-mail regex. Siker után sessionStorage handoff + redirect a kapcsolati
köszönőoldalra. **Itt nincs `/api/lead`, nincs partial, nincs szerveroldali CAPI** — a Lead
mérés kizárólag a köszönőoldalon történik.

---

## 8. Teljes adatfolyam (szekvencia)

### Lead-magnet landing (ebook / sikerdíjas)

```
Felhasználó            Landing (böngésző)           Vercel /api/lead         n8n        Meta (CAPI)        Köszönőoldal
    │                       │                            │                    │            │                   │
    │ oldal betöltés        │── ViewContent ─────────────────────────────────────────────►│ (Pixel+CAPI dedup)│
    │                       │   (attribúció capture localStorage-be)                        │                   │
    │ kitölti 1-2-3. lépés  │                            │                    │            │                   │
    │ cégnév kész           │── POST partial:true ──────►│── n8n (blocking) ─►│            │                   │
    │                       │                            │── CAPI LeadPartial ─────────────►│                   │
    │ befejezi az űrlapot   │── POST partial:false ─────►│── n8n (blocking) ─►│            │                   │
    │                       │                            │── e-mail értesítés (SMTP)        │                   │
    │                       │   sessionStorage.kreativo_lead = {event_id,...}               │                   │
    │                       │── redirect ──────────────────────────────────────────────────────────────────►  │
    │                       │                            │                    │            │   olvas+töröl ─────│
    │                       │                            │                    │            │◄── Lead (Pixel)────│
    │                       │                            │                    │            │◄── Lead (CAPI) ────│ (közös event_id)
    │                       │                            │                    │            │◄── CompleteReg ────│ (csak ebook, csak Pixel)
```

### Egyszerű kapcsolati form

```
Felhasználó       Oldal (böngésző)              n8n (közös webhook)        Meta            Köszönőoldal
    │                  │                              │                      │                  │
    │ kitölti+küld     │── POST (közvetlen) ─────────►│                      │                  │
    │                  │  sessionStorage.kreativo_lead = {event_id,...}      │                  │
    │                  │── redirect ─────────────────────────────────────────────────────────► │
    │                  │                              │                      │◄── Lead (Pixel) ─│
    │                  │                              │                      │◄── Lead (CAPI) ──│ (közös event_id, /api/capi)
```

---

## 9. Reprodukciós checklist (másik oldalon)

1. **Projekt init**
   - [ ] `package.json` `"type": "module"`, függőség: `nodemailer`.
   - [ ] `vercel.json`: `{ "cleanUrls": true, "trailingSlash": false }`.
   - [ ] `api/lead.js` és `api/capi.js` átemelése (lásd forrás vagy a fenti snippetek).
2. **Meta**
   - [ ] Új Pixel + Conversions API token a saját Business Managerben.
   - [ ] `FB_PIXEL_ID` cseréje **mindenhol** (base kód, `<noscript>`, env).
   - [ ] `FB_CAPI_TOKEN` env beállítása (titkos!).
   - [ ] Pixel base + CAPI helper + ViewContent + attribúció snippet a landingekre.
   - [ ] Köszönőoldali Lead (Pixel + CAPI) + opcionális CompleteRegistration.
3. **n8n**
   - [ ] Ebook webhook létrehozása → `N8N_EBOOK_WEBHOOK_URL`.
   - [ ] DirektLead webhook létrehozása → `N8N_DIREKTLEAD_WEBHOOK_URL` (ha kell külön csatorna).
   - [ ] (Opcionális) közös kapcsolati webhook az egyszerű formoknak → URL beégetése a HTML-be.
   - [ ] (Opcionális) Bearer secret + Header Auth node + `*_WEBHOOK_SECRET` env.
   - [ ] Production scope → `/webhook/<id>`, Preview scope → `/webhook-test/<id>`.
4. **E-mail**
   - [ ] SMTP szolgáltató (pl. Mandrill) → `SMTP_HOST/PORT/USER/PASS`, `LEAD_EMAIL_FROM/TO`.
5. **Formok**
   - [ ] Multi-step form a landingekre (`/api/lead`, `lead_type` + `content_name` beállítva).
   - [ ] Egyszerű kapcsolati form a többi oldalra (közvetlen n8n).
   - [ ] Köszönőoldalak `noindex` meta-taggel.
6. **Deploy & teszt**
   - [ ] Vercel deploy, env változók mindhárom scope-ban.
   - [ ] Events Manager → Test Events: `META_TEST_EVENT_CODE` ideiglenes beállítása, majd
         prod előtt **kiürítése**.
   - [ ] Végigtesztelés: ViewContent, LeadPartial, Lead dedup, e-mail megérkezés, n8n rekord.

---

## 10. Tesztelés

CAPI endpoint közvetlen teszt (Test Events kóddal):

```bash
curl -X POST https://<DOMAIN>/api/capi \
  -H "Content-Type: application/json" \
  -d '{
    "event_name": "Lead",
    "event_id": "test-1",
    "event_source_url": "https://<DOMAIN>/koszonjuk-...",
    "event_time": '"$(date +%s)"',
    "email": "test@example.com",
    "phone": "+36301234567",
    "test_event_code": "TEST12345"
  }'
```

`/api/lead` teszt (dev mode — ha nincs n8n URL beállítva és `NODE_ENV !== production`,
`{ ok: true, devMode: true }` jön vissza):

```bash
curl -X POST https://<DOMAIN>/api/lead \
  -H "Content-Type: application/json" \
  -d '{
    "vezeteknev":"Teszt","keresztnev":"Elek","cegnev":"Teszt Kft.",
    "email":"teszt@example.com","telefonszam":"+36301234567",
    "partial":false,"lead_type":"ebook","content_name":"Pályázati Kisokos",
    "forras":"teszt"
  }'
```

A Vercel **Functions** logban (`/api/lead`, `/api/capi`) látszanak a kérések és a
`console.warn/error` üzenetek (pl. „CAPI kihagyva", „n8n kivétel").

---

## 11. Biztonsági és működési megjegyzések

- **Titkok soha git-be.** `FB_CAPI_TOKEN`, `SMTP_PASS`, `*_WEBHOOK_SECRET` kizárólag Vercel
  env. A `.env.example` csak sablon, üres értékekkel. A `.gitignore` kizárja a `.env*`-ot.
- **A token/jelszó forgatása ajánlott**, ha valaha chat/megosztott felületen szerepelt.
- **`META_TEST_EVENT_CODE` prodban legyen ÜRES** — különben az események csak „Test Events"-ként
  számítanak, nem valódi konverzióként.
- **Silent fail elv:** a CAPI és az e-mail hibája **nem** akasztja meg a lead-mentést — a
  felhasználó akkor is sikeres beküldést lát, ha a Meta vagy az SMTP épp nem elérhető. Az
  n8n viszont blocking: ha az hibázik, a kliens 502/503-at kap.
- **`keepalive: true`** a kliens `fetch`-eknél (ViewContent, partial, köszönőoldali Lead),
  hogy a kérés akkor is kimenjen, ha közben oldalváltás történik.
- **Timeoutok:** CAPI hívás 8 mp (`/api/lead`-ből), n8n hívás 9 mp. A Vercel serverless
  függvénynek ezek alatt be kell fejeznie, ezért várjuk be a háttér-promise-okat válasz előtt.
- **`docs/` nem deployolódik** (`.vercelignore`) — ez a dokumentum is belső marad.
```
