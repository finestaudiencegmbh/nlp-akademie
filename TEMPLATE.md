# Neues Dashboard aufsetzen

Diese Codebasis ist eine Vorlage. Der funktionierende Kern – Meta-Marketing-API,
UTM-Attribution, Charts, Chatbot – bleibt unangetastet. Pro Projekt änderst du
**eine Datei und ein paar Env-Vars**.

Gesamtdauer beim ersten Mal: ca. 60–90 Minuten, danach 20.

---

## 1. Repo kopieren

```bash
git clone <dieses-repo> mein-neues-dashboard
cd mein-neues-dashboard
rm -rf .git && git init
npm install
```

## 2. `config/project.config.json` ausfüllen

Das ist die einzige Datei, die jedes Projekt anfassen muss.

| Feld | Bedeutung |
|---|---|
| `name` | Voller Projektname. Steht in der Topbar, im Browser-Titel, im Basic-Auth-Dialog und im System-Prompt des Chatbots. |
| `shortName` | Kurzform für die Sidebar. |
| `subtitle` | Zeile unter dem Namen, z. B. `"Workshop · 15.–18.06."`. |
| `slug` | Kleinschreibung, ohne Leerzeichen. Wird für den CSV-Dateinamen benutzt. |
| `branding.accent` | Akzentfarbe als Hex. Hover-, Glow- und Linien-Töne leitet das Frontend automatisch ab. |
| `branding.logo` | Pfad zu einer Datei in `web/public/`, z. B. `/logo.svg`. |
| `features.hasTickets` | Gibt es eine zweite Conversion-Stufe nach dem Lead (Ticket, Upgrade, Bewerbung)? |
| `features.hasQuality` | Gibt es einen Fragebogen mit Lead-Scoring? Setzt `hasTickets` voraus – die Antworten stecken im Ticket-Tab. |
| `labels.ticket` | Wie die zweite Stufe heißt: `one` (Einzahl), `many` (Mehrzahl), `short` (Badge/Spalte). |
| `sheet.detect` | Wie die Tabellen im Sheet erkannt werden (siehe unten). |
| `sheet.columns` | Spaltenüberschriften je Tabelle. |
| `sheet.answers` | Die Fragebogen-Spalten inkl. Anzeigename. |

### Was bei `hasTickets: false` verschwindet

Tickets-Spalte, €/Ticket, CVR Ticket, Kosten/Ticket, Ticket-KPI-Karten, die
Ticket-Linie im Verlaufsgraphen, der Ticket-KPI im Grafik-Panel, Ticket-Spalte
in der Leadliste und im CSV, Ticket-Felder im Chatbot-Kontext. Übrig bleibt ein
sauberes Lead-Dashboard mit Spend, CPL, CTR, CPM und Quellen-Aufschlüsselung.

### Was bei `hasQuality: false` verschwindet

Quali-Rate, Ø Quali, Tier A–D, Verteilungsbalken, Qualitäts-Verlauf, die
Fragebogen-Filter, das Antworten-Detail beim Aufklappen eines Leads, die
Antwort-Spalten im CSV und alle Quali-Felder im Chatbot-Kontext.

### Sheet-Mapping

Der Parser sucht **keine Tab-Namen**, sondern erkennt jede Tabelle an ihrer
Kopfzeile. Ein Tab darf mehrere Tabellen untereinander enthalten.

```jsonc
"detect": {
  "overview": [{ "all": ["anzeigengruppe", "adspend"] }],
  "tickets":  [{ "some": ["monatliches einkommen"] }, { "all": ["teilgenommen am", "vorname"] }],
  "leads":    [{ "all": ["gewonnen am"], "some": ["utm_source", "e-mail"] }]
}
```

Eine Regel trifft, wenn **alle** `all`-Spalten vorhanden sind **und** (falls
`some` gesetzt ist) mindestens eine `some`-Spalte. Mehrere Regeln je Typ = ODER.
Reihenfolge der Prüfung ist die Reihenfolge im JSON.

Spaltennamen werden normalisiert verglichen: klein geschrieben, ohne `? : .`,
Mehrfach-Leerzeichen zusammengefasst. `"Monatliches Einkommen?"` im Sheet
trifft also den Config-Eintrag `"monatliches einkommen"`.

Bei den `columns` ist jeder Wert eine **Liste** – der erste nicht-leere Treffer
gewinnt. Praktisch für Sheets, in denen eine Spalte mal so und mal anders heißt.

### Fragebogen und Scoring

Die Schlüssel unter `sheet.answers` verbinden Sheet und Bewertungsmodell:
`income`, `invested`, `realEstate` und `employment` werden von
`config/scoring.json` bewertet, alle anderen nur angezeigt und exportiert.

- Anderer Fragebogen, gleiche Logik → nur die `columns` austauschen.
- Zusätzliche Frage → neuen Schlüssel ergänzen (`label`, `columns`, optional
  `filter: true` für einen Dropdown-Filter, `wide: true` für Freitext).
- Anderes Bewertungsmodell → `config/scoring.json` anpassen (Gewichte, Stufen,
  Tiers, Haushaltsregel). Der Code bleibt gleich.

### Logo

`web/public/logo.svg` ersetzen oder eine neue Datei dort ablegen und in
`branding.logo` eintragen. Das mitgelieferte Logo nutzt die Akzentfarbe – wenn
du ein SVG behältst, dort den Hex-Wert mitändern.

## 3. Weitere Konfigurationsdateien (meist unverändert)

| Datei | Wann anfassen |
|---|---|
| `config/scoring.json` | Anderes Bewertungsmodell für die Lead-Qualität. |
| `config/campaigns.json` | Welche Kampagnen als Lead-Kampagnen zählen (Meta-`objective` + manuelle Overrides) und welche UTM-Muster als organisch gelten (`organicPatterns`, z. B. `manychat`, `bio`, der Kampagnen-Slug). |
| `config/supermetrics.json` | Nur relevant, wenn statt der Meta-API Supermetrics genutzt wird. |

Die `organicPatterns` in `campaigns.json` enthalten oft den Workshop-Slug des
Vorgängerprojekts – hier den neuen eintragen, sonst landen organische Leads im
Paid-Container.

## 4. Google Sheet anbinden

1. In der **Google Cloud Console** ein Projekt anlegen, die **Google Sheets API**
   aktivieren, einen **Service-Account** erstellen und einen JSON-Key
   herunterladen.
2. Das Tracking-Sheet für die E-Mail-Adresse des Service-Accounts freigeben
   (Leseberechtigung reicht).
3. Die Sheet-ID aus der URL zwischen `/d/` und `/edit` in `SPREADSHEET_ID`
   eintragen.

Ohne diese Konfiguration startet das Dashboard im **Demo-Modus** mit
synthetischen Daten – gut zum Ansehen des Layouts vor dem echten Anschluss.

## 5. Meta (Facebook) anbinden

1. Im **Meta Business Manager** eine App mit Zugriff auf das Werbekonto anlegen.
2. Access-Token mit der Berechtigung **`ads_read`** erzeugen (langlebiges Token
   verwenden, sonst läuft es nach Stunden ab).
3. Werbekonto-ID (`act_…`) eintragen. Mehrere Konten: kommagetrennt.

## 6. Lokal starten

```bash
cp .env.example .env    # und ausfüllen
npm run dev             # Server + Vite, http://localhost:5173
npm test                # muss grün sein
```

## 7. Deployen (Render)

`render.yaml` ist ein fertiger Blueprint. Anpassen: `name` (bestimmt die URL).
Alle Secrets stehen auf `sync: false` und werden beim Deploy abgefragt.

```bash
npm run serve   # lokal wie in Production (Build + Server auf einem Port)
```

---

## Env-Vars

### Pflicht für echte Daten

| Variable | Beispiel | Zweck |
|---|---|---|
| `SPREADSHEET_ID` | `1rxK4s-…` | ID des Tracking-Sheets (aus der URL). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `{"type":"service_account",…}` | Kompletter Service-Account-Key als **eine Zeile**. Für Hosting der richtige Weg. |
| `GOOGLE_APPLICATION_CREDENTIALS` | `./service-account.json` | Alternative für lokal: Pfad zur Key-Datei. Wird von `GOOGLE_SERVICE_ACCOUNT_JSON` überstimmt. **Nie committen.** |

### Meta Marketing API (Facebook-Kennzahlen)

| Variable | Beispiel | Zweck |
|---|---|---|
| `META_ACCESS_TOKEN` | `EAAG…` | Token mit `ads_read`. |
| `META_AD_ACCOUNT_ID` | `act_123…` | Werbekonto; mehrere kommagetrennt. |
| `META_API_VERSION` | `v21.0` | Optional, Graph-API-Version. |
| `META_LOOKBACK_DAYS` | `90` | Optional, Zeitfenster ohne expliziten Datumsbereich. |

Ohne diese Variablen läuft das Dashboard weiter – nur die Facebook-Kennzahlen
fehlen, Leads aus dem Sheet bleiben vollständig.

### Zugangsschutz

| Variable | Zweck |
|---|---|
| `DASHBOARD_USER` | Benutzername für Basic Auth. Leer = kein Schutz. |
| `DASHBOARD_PASSWORD` | Passwort für Basic Auth. |

Beide setzen, sobald die URL geteilt wird. `/api/health` bleibt bewusst offen,
sonst scheitert der Health-Check des Hosters.

### KI-Chatbot

| Variable | Zweck |
|---|---|
| `ANTHROPIC_API_KEY` | Aktiviert den Analyse-Assistenten. Leer = Chat-Button aus. |

### Betrieb

| Variable | Default | Zweck |
|---|---|---|
| `PORT` | `3000` | Server-Port. |
| `CACHE_TTL_SECONDS` | `900` | Wie lange Sheet-/Meta-Daten gecacht werden. Der Button „Aktualisieren" umgeht den Cache. |

### Supermetrics (Alternative zur Meta-API, optional)

`SUPERMETRICS_API_KEY`, `SUPERMETRICS_DS_ACCOUNTS`, `SUPERMETRICS_DS_USER`,
`SUPERMETRICS_QUERY_JSON`. Wird nur genutzt, wenn **kein** Meta-Token gesetzt
ist. Die Meta-API ist der bessere Weg: mehr Kennzahlen, Hierarchie und
Ad-Status.

---

## Checkliste pro neuem Projekt

- [ ] `config/project.config.json`: Name, Subtitle, Slug, Akzentfarbe, Logo
- [ ] `config/project.config.json`: `features.hasTickets` / `hasQuality` gesetzt
- [ ] `config/project.config.json`: `labels.ticket` passend benannt
- [ ] `config/project.config.json`: `sheet.detect` und `sheet.columns` gegen das echte Sheet geprüft
- [ ] `config/project.config.json`: `sheet.answers` auf den neuen Fragebogen gemappt
- [ ] `config/campaigns.json`: `organicPatterns` auf den neuen Kampagnen-Slug
- [ ] `config/scoring.json`: Bewertungsmodell geprüft (oder unverändert übernommen)
- [ ] `web/public/logo.svg` ersetzt
- [ ] `render.yaml`: `name` angepasst
- [ ] Sheet für den Service-Account freigegeben
- [ ] `.env` gefüllt, `npm test` grün, `npm run dev` zeigt echte Zahlen

## Architektur in zehn Zeilen

```
Google Sheet ─► sheets.js ─► parser.js ─┐
                                        ├─► build.js ─► Lead-Records (UTM → Kampagne/Anzeigengruppe/Creative)
Meta API ────► meta.js ─────────────────┘        │
                                                 └─► combine.js ─► Hierarchie + Tagesreihen
                                                                        │
                                        index.js (/api/data, /api/config)
                                                                        │
                                        React-Frontend (project.jsx liefert Flags + Branding)
```

Was du beim Erweitern nicht anfassen musst: `meta.js` (API-Abruf, Rate-Limits,
Retries), `combine.js` (hierarchische Attribution), die Chart-Komponenten.
