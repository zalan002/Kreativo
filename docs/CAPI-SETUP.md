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
| `N8N_WEBHOOK_URL` | `https://…/webhook/…` | A lead routing webhook. Ha üres, a kód a korábbi hardcode-olt URL-re esik vissza. |
| `N8N_WEBHOOK_SECRET` | tetszőleges titok | Opcionális — `Authorization: Bearer <secret>` header az n8n felé. |

4. Redeploy a projektet (vagy a következő push-nál automatikusan érvénybe lép)

### Token regenerálása

A jelenlegi access token egy chat felületen lett megosztva. **Erősen ajánlott regenerálni a tokent**, mielőtt élesbe kerül:

- Meta Events Manager → kiválasztott Pixel → Settings → Conversions API → Generate access token

Az új tokent kizárólag a Vercel env változóba kell beilleszteni.

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

A multi-step form (`palyazati-kisokos.html`) ide POST-ol — teljes (`partial: false`) és részleges (`partial: true`) submitnél egyaránt. Az endpoint:

1. Validálja a payloadot (`vezeteknev`, `keresztnev`, `email`, `telefonszam` mindig kötelező; `cegnev` csak teljes submitnél).
2. Szerveroldali enrichment: kliens IP (`X-Forwarded-For`), User-Agent, `_fbp` / `_fbc` cookie-k.
3. **n8n webhook** (`N8N_WEBHOOK_URL`) — blocking hívás, ez a source of truth. Non-2xx vagy timeout → 502.
4. **Meta CAPI** — non-blocking, silent fail. Teljes submitnél `Lead`, részlegesnél `LeadPartial` event. SHA-256 hash-elt PII, `_fbc` rekonstrukció `fbclid`-ből, ha a cookie hiányzik.

A teljes `Lead` event_id a form betöltésekor generálódik, és ugyanaz megy a CAPI-ba **és** a kliens oldali Pixelbe (sikeres submit után) → Meta deduplikáció. A `LeadPartial` külön event_id-t kap, így nem dedupolódik a `Lead`-del.

A `/api/lead` endpoint válaszai:

| HTTP kód | Jelentés |
|---|---|
| 200 | Sikeres beküldés (`{ ok: true }`), vagy dev mode (`{ ok: true, devMode: true }`, ha nincs `N8N_WEBHOOK_URL`). |
| 400 | Érvénytelen JSON törzs. |
| 405 | Nem POST request. |
| 422 | Hiányzó kötelező mező / érvénytelen e-mail / érvénytelen telefonszám. |
| 502 | Az n8n webhook hibát adott vagy nem elérhető. |
| 503 | Prodban nincs `N8N_WEBHOOK_URL` beállítva. |

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
