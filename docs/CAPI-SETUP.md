# Facebook Conversions API — beállítás

## Áttekintés

A `palyazati-kisokos.html` landing oldal a Facebook Pixel mellett szerveroldali **Conversions API (CAPI)** eseményeket is küld, deduplikált módon. Ez két eseményt érint:

| Esemény | Mikor tüzel | Pixel + CAPI dedup |
|---|---|---|
| **ViewContent** | Oldal betöltéskor | ✅ közös `event_id` |
| **Lead** | Sikeres form-küldéskor | ✅ közös `event_id` |

A `PageView` továbbra is csak Pixel-oldalon tüzel (default Meta Pixel viselkedés).

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

## Hibakeresés

A `/api/capi` endpoint válaszai:

| HTTP kód | Jelentés |
|---|---|
| 200 | Esemény sikeresen továbbítva. A response body tartalmazza a Facebook válaszát. |
| 400 | Hibás payload (nem támogatott `event_name`, érvénytelen JSON). |
| 405 | Nem POST request. |
| 500 | Hiányzó env változó vagy belső hiba. A response body tartalmazza a részletet. |
| 502 | Facebook API hibát adott. A response body-ban a Facebook hibakódja és üzenete. |

A Vercel function log-jában (Vercel dashboard → Functions → /api/capi) látszanak a kérések.
