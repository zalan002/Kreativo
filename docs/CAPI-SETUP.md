# Facebook Conversions API — beállítás

## Áttekintés

A `palyazati-kisokos.html` landing oldal a Facebook Pixel mellett szerveroldali **Conversions API (CAPI)** eseményeket is küld, deduplikált módon. Az eseménytérkép:

| Esemény | Mikor tüzel | Hol | Pixel + CAPI dedup |
|---|---|---|---|
| **PageView** | Oldal betöltéskor | landing | csak Pixel |
| **ViewContent** | Oldal betöltéskor | landing (`/api/capi`) | ✅ közös `event_id` |
| **LeadPartial** | A telefon lépcső után (partial save) | `/api/lead` → CAPI custom event | csak CAPI |
| **Lead** | Sikeres teljes form-küldéskor | landing Pixel + `/api/lead` → CAPI | ✅ közös `event_id` |
| **CompleteRegistration** | Köszönő oldal megnyitásakor | `koszonjuk-az-erdeklodest.html` | csak Pixel |

A multi-step lead form a `/api/lead` endpointra POST-ol (lásd lejjebb), ami az n8n webhookot (source of truth, blocking) és a Meta CAPI-t (non-blocking, silent fail) is hívja.

## Architektúra

```
Böngésző                    Vercel Serverless Function       Facebook
────────                    ────────────────────────         ────────
fbq('track', 'Lead', ...)   ┌──────────────────────────┐
       └─ event_id ─────────┤  /api/capi               │
                            │   - hash email/phone     │
fetch('/api/capi', {...})───┤   - server IP/UA         │──→ graph.facebook.com
                            │   - forward + dedup      │     /v19.0/{PIXEL_ID}/events
                            └──────────────────────────┘
```

## Vercel env-változók beállítása

A `/api/capi.js` két környezeti változót olvas. **Ezeket Vercel oldalán kell beállítani** — soha ne kerüljenek a kódba vagy git-be.

### Lépések

1. Nyisd meg a Vercel projekt dashboard-ot
2. Settings → Environment Variables
3. Add hozzá az alábbi két változót, mindhárom környezetre (Production, Preview, Development):

| Név | Érték | Megjegyzés |
|---|---|---|
| `FB_PIXEL_ID` | `3511173002462631` | A Meta Pixel ID-ja (a böngészőben is látható, nem titkos) |
| `FB_CAPI_TOKEN` | `EAA…` (lásd lejjebb) | **TITKOS** — Conversions API access token |
| `META_TEST_EVENT_CODE` | `TEST12345` v. üres | Opcionális — Events Manager Test Events kód. **Prodban üresen!** |
| `N8N_EBOOK_WEBHOOK_URL` | `https://…/webhook/…` | Az ebook letöltő leadek routing webhookja. Prodban kötelező; Production és Preview scope-ban külön értékkel (prod / n8n teszt URL). |
| `N8N_EBOOK_WEBHOOK_SECRET` | tetszőleges titok | Opcionális — `Authorization: Bearer <secret>` header az n8n felé. |
| `N8N_DIREKTLEAD_WEBHOOK_URL` | `https://…/webhook/63b7d14f-…` | A sikerdíjas pályázatírás landing direkt érdeklődőinek routing webhookja — külön n8n csatorna. Prodban kötelező ehhez a landinghoz; Production és Preview scope-ban külön értékkel (prod / `webhook-test` URL). |
| `N8N_DIREKTLEAD_WEBHOOK_SECRET` | tetszőleges titok | Opcionális — `Authorization: Bearer <secret>` header az n8n felé. |
| `SMTP_HOST` | `smtp.mandrillapp.com` | E-mail értesítés — SMTP host (Mandrill). |
| `SMTP_PORT` | `587` | SMTP port (STARTTLS). |
| `SMTP_USER` | `Training Hungary Kft.` | SMTP felhasználónév (Mandrillnál bármi elfogadott). |
| `SMTP_PASS` | `md-…` | **TITKOS** — Mandrill SMTP jelszó / API kulcs. |
| `LEAD_EMAIL_FROM` | `info@kreativo.hu` | Feladó cím (Mandrillban visszaigazolt domain ajánlott). |
| `LEAD_EMAIL_TO` | üres v. `a@x,b@y` | Címzettek vesszővel. Üresen: prod → `info@kreativo.hu,zalan@traininghungary.com`, egyébként → `zalan@traininghungary.com`. |

4. Redeploy a projektet (vagy a következő push-nál automatikusan érvénybe lép)

### Token / jelszó regenerálása

A jelenlegi CAPI access token és a Mandrill SMTP jelszó is chat felületen lett megosztva. **Erősen ajánlott mindkettőt regenerálni**, mielőtt élesbe kerül:

- Meta Events Manager → kiválasztott Pixel → Settings → Conversions API → Generate access token
- Mandrill (Mailchimp Transactional) → Settings → SMTP & API Info → új API kulcs

Az új értékeket kizárólag a Vercel env változókba kell beilleszteni — soha ne kerüljenek git-be.

## Tesztelés

A Meta Events Manager-ben létrehozható egy **Test Event Code** (TEST12345 formátumú). Ezt elküldve a `/api/capi`-nak a payload-ban (`test_event_code: "TEST12345"`), az események külön "Test Events" tab-ban jelennek meg, anélkül hogy az éles attribúciót befolyásolnák.

Példa lokális teszt:

```bash
curl -X POST https://kreativo.hu/api/capi \
  -H "Content-Type: application/json" \
  -d '{
    "event_name": "Lead",
    "event_id": "test-1",
    "event_source_url": "https://kreativo.hu/palyazati-kisokos",
    "event_time": '"$(date +%s)"',
    "email": "test@example.com",
    "phone": "+36301234567",
    "test_event_code": "TEST12345"
  }'
```

## Mit lát a Facebook?

Pixel oldalról (kliens):
- `event_name`, `event_id`
- Cookie-k (fbp, fbc — ezek automatikusan)
- URL, User-Agent

CAPI oldalról (szerver):
- `event_name`, `event_id` (= ugyanaz, mint a Pixel-en — ez kell a deduphoz)
- SHA-256 hash-elt e-mail és telefonszám (Lead esetén)
- Szerveroldali kliens IP és User-Agent (`X-Forwarded-For`-ból + headers)
- `event_source_url`, `event_time`

A két esemény ugyanazzal az `event_id`-vel és `event_name`-mel érkezik be Facebookhoz, így a rendszer felismeri a duplikációt és csak egy eseményként számolja el — viszont a CAPI miatt akkor is megérkezik az adat, ha az ad-blocker vagy iOS tracking limitáció miatt a Pixel oldali esemény kiesett volna.

## `/api/lead` — lead capture endpoint

A multi-step formok (`palyazati-kisokos.html` ebook landing, `sikerdijas-palyazatiras.html` direkt érdeklődő landing) ide POST-olnak — teljes (`partial: false`) és részleges (`partial: true`) submitnél egyaránt. Az endpoint:

1. Validálja a payloadot (`vezeteknev`, `keresztnev`, `email`, `telefonszam`, `cegnev` mindig kötelező; `adoszam` csak teljes submitnél; `palyazati_konstrukcio`, `megvalositasi_helyszin`, `megjegyzes` opcionális — ezeket a sikerdíjas landing küldi).
2. Szerveroldali enrichment: kliens IP (`X-Forwarded-For`), User-Agent, `_fbp` / `_fbc` cookie-k.
3. **n8n webhook** — blocking hívás, ez a source of truth. A `lead_type` alapján routol: a sikerdíjas pályázatírás landing direkt érdeklődői a `N8N_DIREKTLEAD_WEBHOOK_URL`-re, minden más lead a `N8N_EBOOK_WEBHOOK_URL`-re megy. Non-2xx vagy timeout → 502. Ha a vonatkozó env változó nincs beállítva → 503 (dev környezetben devMode válasz).
4. **Meta CAPI** — non-blocking, silent fail. **Csak a részleges (`partial: true`) submitről** megy innen CAPI esemény (`LeadPartial`). A teljes (`partial: false`) `Lead` esemény nem itt, hanem a **köszönőoldalon** tüzel (Pixel + CAPI, deduplikálva). SHA-256 hash-elt PII, `_fbc` rekonstrukció `fbclid`-ből, ha a cookie hiányzik.
5. **E-mail értesítés** (nodemailer, `SMTP_*`) — non-blocking, silent fail. **Csak a teljes (`partial: false`) submitről** megy értesítő e-mail; a tárgy és a törzs egyértelműen jelzi a lead jellegét — „Ebook letöltő” vagy „Direkt érdeklődő”. Részleges (`partial: true`) leadről **soha nem** megy e-mail — az kizárólag az n8n-hez és a Meta CAPI-hoz (`LeadPartial`) jut el. A címzettek, az SMTP kapcsolat és a feladó cím minden lead-típusnál azonos.

### A teljes `Lead` esemény — a köszönőoldalon tüzel

Minden űrlapnál (lead-magnet landingek és a sima kapcsolati űrlapok egyaránt) a teljes `Lead` esemény a **köszönőoldalon** tüzel, Pixel + CAPI párban, közös `event_id`-vel deduplikálva:

- A landing a sikeres beküldés után `sessionStorage.kreativo_lead`-be írja az `event_id`-t, e-mailt, telefonszámot, `content_name`-et és `forras`-t, majd átirányít a köszönőoldalra.
- A köszönőoldal (`koszonjuk-a-kapcsolatfelvetelt.html`, illetve az ebooknál `koszonjuk-az-erdeklodest.html`) kiolvassa és azonnal törli a `sessionStorage` bejegyzést, majd tüzeli a Pixel `Lead`-et és a `/api/capi` felé a CAPI `Lead`-et — ugyanazzal az `event_id`-vel, így a Meta egy eseményként számolja el.
- A lead-magnet landingek `event_id`-je a form betöltésekor generálódik, és ugyanez megy az n8n-hez is. A `LeadPartial` külön `event_id`-t kap, így nem dedupolódik a `Lead`-del.

A `/api/lead` endpoint válaszai:

| HTTP kód | Jelentés |
|---|---|
| 200 | Sikeres beküldés (`{ ok: true }`), vagy dev mode (`{ ok: true, devMode: true }`, ha nincs n8n webhook URL beállítva). |
| 400 | Érvénytelen JSON törzs. |
| 405 | Nem POST request. |
| 422 | Hiányzó kötelező mező / érvénytelen e-mail / érvénytelen telefonszám. |
| 502 | Az n8n webhook hibát adott vagy nem elérhető. |
| 503 | Prodban nincs a lead-típushoz tartozó n8n webhook URL beállítva (`N8N_EBOOK_WEBHOOK_URL` / `N8N_DIREKTLEAD_WEBHOOK_URL`). |

## Hibakeresés

A `/api/capi` endpoint válaszai:

| HTTP kód | Jelentés |
|---|---|
| 200 | Esemény sikeresen továbbítva. A response body tartalmazza a Facebook válaszát. |
| 400 | Hibás payload (nem támogatott `event_name`, érvénytelen JSON). |
| 405 | Nem POST request. |
| 500 | Hiányzó env változó vagy belső hiba. A response body tartalmazza a részletet. |
| 502 | Facebook API hibát adott. A response body-ban a Facebook hibakódja és üzenete. |

A Vercel function log-jában (Vercel dashboard → Functions → /api/capi, /api/lead) látszanak a kérések.
