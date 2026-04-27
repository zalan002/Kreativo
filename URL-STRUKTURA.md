# Kreativo Magyarország — WordPress URL struktúra

## Oldaltérkép

| # | HTML fájl | WordPress URL (slug) | Oldal neve | Megjegyzés |
|---|-----------|----------------------|------------|------------|
| 1 | `index.html` | `/` | Kezdőlap | Főoldal — WordPress "Front page" |
| 2 | `szolgaltatasaink.html` | `/szolgaltatasaink/` | Szolgáltatásaink | Szolgáltatás áttekintő oldal |
| 3 | `szolgaltatasaink-palyazatfigyeles.html` | `/szolgaltatasaink/palyazatfigyeles/` | Pályázatfigyelés | Szolgáltatás aloldal |
| 4 | `szolgaltatasaink-palyazati-tanacsadas.html` | `/szolgaltatasaink/palyazati-tanacsadas/` | Pályázatírás és tanácsadás | Szolgáltatás aloldal |
| 5 | `szolgaltatasaink-projektmenedzsment.html` | `/szolgaltatasaink/projektmenedzsment/` | Projektmenedzsment | Szolgáltatás aloldal |
| 6 | `szolgaltatasaink-kozbeszerzesi-tanacsadas.html` | `/szolgaltatasaink/kozbeszerzesi-tanacsadas/` | Közbeszerzési tanácsadás | Szolgáltatás aloldal |
| 7 | `szolgaltatasaink-uzletviteli-tanacsadas.html` | `/szolgaltatasaink/uzletviteli-tanacsadas/` | Üzletviteli tanácsadás | Szolgáltatás aloldal |
| 8 | `szolgaltatasaink-biztositeknyujtas.html` | `/szolgaltatasaink/biztositeknyujtas/` | Biztosítéknyújtás | Szolgáltatás aloldal |
| 9 | `szolgaltatasaink-hitelkozvetites.html` | `/szolgaltatasaink/hitelkozvetites/` | Hitelközvetítés | Szolgáltatás aloldal |
| 10 | `palyazatfigyeles.html` | `/palyazatfigyeles/` | Pályázatfigyelés (landing) | Önálló landing page |
| 11 | `referenciaink.html` | `/referenciaink/` | Partnereink és referenciáink | Referencia oldal |
| 12 | `kapcsolat.html` | `/kapcsolat/` | Kapcsolat | Kapcsolat oldal — form + elérhetőségek |
| 13 | `koszonjuk-a-kapcsolatfelvetelt.html` | `/koszonjuk-a-kapcsolatfelvetelt/` | Köszönjük a kapcsolatfelvételt | Form submit utáni köszönő oldal (noindex) |
| 14 | `koszonjuk-az-erdeklodest.html` | `/koszonjuk-az-erdeklodest/` | Köszönjük az érdeklődést | E-book letöltő köszönő oldal (noindex) |

---

## WordPress oldal hierarchia

```
kreativo.hu/
├── / ............................ Kezdőlap (index.html)
├── /szolgaltatasaink/ ........... Szolgáltatás áttekintő (szolgaltatasaink.html)
│   ├── /palyazatfigyeles/ ....... Pályázatfigyelés
│   ├── /palyazati-tanacsadas/ ... Pályázatírás és tanácsadás
│   ├── /projektmenedzsment/ ..... Projektmenedzsment
│   ├── /kozbeszerzesi-tanacsadas/ Közbeszerzési tanácsadás
│   ├── /uzletviteli-tanacsadas/ . Üzletviteli tanácsadás
│   ├── /biztositeknyujtas/ ...... Biztosítéknyújtás
│   └── /hitelkozvetites/ ........ Hitelközvetítés
├── /palyazatfigyeles/ ........... Pályázatfigyelés landing
├── /referenciaink/ .............. Referenciáink
├── /kapcsolat/ .................. Kapcsolat (form + elérhetőségek + térkép)
├── /koszonjuk-a-kapcsolatfelvetelt/ ... Köszönő oldal — kapcsolatfelvétel után
└── /koszonjuk-az-erdeklodest/ ... Köszönő oldal — e-book letöltés (Pályázati Kisokos)
```

---

## Belső hivatkozások összesítése

### index.html (Kezdőlap) hivatkozásai:
- `szolgaltatasaink-palyazatfigyeles.html` → `/szolgaltatasaink/palyazatfigyeles/`
- `szolgaltatasaink-palyazati-tanacsadas.html` → `/szolgaltatasaink/palyazati-tanacsadas/`
- `szolgaltatasaink-projektmenedzsment.html` → `/szolgaltatasaink/projektmenedzsment/`
- `szolgaltatasaink-kozbeszerzesi-tanacsadas.html` → `/szolgaltatasaink/kozbeszerzesi-tanacsadas/`
- `szolgaltatasaink-uzletviteli-tanacsadas.html` → `/szolgaltatasaink/uzletviteli-tanacsadas/`
- `szolgaltatasaink-hitelkozvetites.html` → `/szolgaltatasaink/hitelkozvetites/`
- `#kapcsolat` → oldal belső anchor (marad)

### szolgaltatasaink.html (Szolgáltatások áttekintő) hivatkozásai:
- Ugyanazok a szolgáltatás aloldalak, mint a kezdőlapon
- `index.html#kapcsolat` → `/#kapcsolat` vagy `/szolgaltatasaink/#kapcsolat`

### Form (minden oldalon):
- Webhook (POST JSON) → `https://traininghungary.app.n8n.cloud/webhook/35919594-6d84-45ee-b920-fc1f8067cce0`
- Sikeres küldés után redirect → `https://kreativo.hu/koszonjuk-a-kapcsolatfelvetelt.html`
- E-book űrlap sikeres küldés után → `koszonjuk-az-erdeklodest.html`

> **Megjegyzés:** a redirect az `.html` kiterjesztést használja, mert a site jelenleg statikus fájlokból van kiszolgálva (Vercel). Ha később WordPress-re vagy `cleanUrls`-szel rendelkező hostingra kerül, a redirect URL átállítható `/koszonjuk-a-kapcsolatfelvetelt/`-re.

---

## WordPress beállítási teendők

1. **Permalink beállítás:** Beállítások → Állandó hivatkozások → „Bejegyzés neve" (`/%postname%/`)
2. **Oldalak létrehozása:** A fenti hierarchia szerint, szülő oldalak megadásával
3. **Kezdőlap:** Beállítások → Olvasás → „Statikus oldal" → Kezdőlap: `index.html` tartalma
4. **Menü:** A WordPress menüben a header/footer navigációt kell beállítani
5. **Köszönő oldalak:**
   - `/koszonjuk-a-kapcsolatfelvetelt/` — kapcsolatfelvételi form sikeres küldés után (`koszonjuk-a-kapcsolatfelvetelt.html`)
   - `/koszonjuk-az-erdeklodest/` — e-book letöltési form sikeres küldés után (`koszonjuk-az-erdeklodest.html`)
   - Mindkét oldal `noindex` meta-tagot kap, hogy ne kerüljenek a keresőbe.
6. **E-book fájl:** `/ebook/palyazati-kisokos-kreativo.pdf` — a köszönő oldalon letölthető (Pályázati Kisokos PDF, 873 KB)
