/**
 * Prüft die AKTUELLE Projekt-Konfiguration (config/project.config.json) gegen
 * den echten Aufbau des Tracking-Sheets: Tabellen-Erkennung, Spalten-Mapping,
 * UTM-Rollen und das Scoring-Modell. Schlägt fehl, sobald Config und Sheet
 * auseinanderlaufen. Ausführen: node server/project.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSheets } from './parser.js';
import { buildDataset } from './build.js';
import { loadScoringConfig, computeQuality, qualifiedTiersOf } from './scoring.js';
import { loadProjectConfig } from './project.js';

const PROJECT = loadProjectConfig();
const scoring = loadScoringConfig();

// Kopfzeilen 1:1 aus dem Sheet "J&P | NLP Akademie | Online-Workshop Leads"
const leadsSheet = {
  title: 'Online-Workshop Leads',
  values: [
    ['Datum Eintragung', 'Vorname', 'Nachname', 'E-Mail', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'],
    ['0', '', '', '', '', '', '', '', ''], // Zählzeile – muss ignoriert werden
    ['2026-09-11 22:40:45', 'Roman', 'Huber', 'roman@example.com', 'meta', 'paid', 'JP | RML 14. & 15.10. | WARM UP | CBO | 101026', 'JP | Broad | CH | 30+', 'Video Hook A'],
    ['2026-09-11 23:10:00', 'Anna', 'Muster', 'anna@example.com', 'meta', 'paid', 'JP | RML 14. & 15.10. | WARM UP | CBO | 101026', 'JP | Broad | CH | 30+', 'Static 2'],
    ['2026-09-12 08:00:00', 'Orga', 'Nisch', 'orga@example.com', 'instagram', 'manychat', 'rml-workshop', '', ''],
    ['2026-09-12 09:30:00', 'Beat', 'Keller', 'beat@example.com', 'meta', 'paid', 'JP | RML 14. & 15.10. | WARM UP | CBO | 101026', 'JP | Broad | CH | 30+', 'Static 2'],
  ],
};

const umfrageSheet = {
  title: 'Online-Workshop Umfrage',
  values: [
    ['Datum Eintragung', 'Vorname', 'Nachname', 'E-Mail', 'Handynummer', 'Berufsbezeichnung', 'Alter', 'Größte Herausforderung', 'Dringlichkeit Lösung', 'Einkommen', 'Erwartung an Workshop', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'],
    ['0', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['2026-09-11 22:42:45', 'Roman', 'Huber', 'roman@example.com', '41796000000', 'Angestellt', '40-49 Jahre', 'Allem gerecht werden', 'In den nächsten Wochen', '2.000 - 2.999 €', 'Ich möchte weiterkommen', 'meta', 'paid', 'JP | RML 14. & 15.10. | WARM UP | CBO | 101026', 'JP | Broad | CH | 30+', 'Video Hook A'],
    // Leitregel: über 3.000 € = A-Lead, auch wenn alle anderen Antworten schwach sind
    ['2026-09-12 09:35:00', 'Beat', 'Keller', 'beat@example.com', '41790000000', 'Angestellt', '50-59 Jahre', 'Keine Struktur', 'Irgendwann', '3.000 - 3.999 €', 'Mal reinschauen', 'meta', 'paid', 'JP | RML 14. & 15.10. | WARM UP | CBO | 101026', 'JP | Broad | CH | 30+', 'Static 2'],
  ],
};

// Der Funnel-Tab darf von KEINER Regel erkannt werden
const funnelSheet = {
  title: 'Workshop Funnel',
  values: [
    ['Seite', 'URL', 'Leads', 'CVR Umfrage', 'Event'],
    ['Start', 'https://example.test/', '', '', ''],
    ['Dankesseite 1', 'https://example.test/danke-1', '0', '', 'Lead'],
  ],
};

const parsed = parseSheets([leadsSheet, umfrageSheet, funnelSheet], PROJECT.sheet, PROJECT.features);

assert.equal(parsed.leads.length, 4, 'vier Leads erkannt (Zählzeile ignoriert)');
assert.equal(parsed.tickets.length, 2, 'zwei Umfrage-Zeilen erkannt');
assert.equal(parsed.overview.length, 0, 'Funnel-Tab wird nicht als Übersicht missdeutet');
assert.equal(parsed.leads[0].wonAt, '2026-09-11T22:40:45.000Z', 'Zeitstempel ohne Zonenangabe als UTC gelesen');
assert.equal(parsed.tickets[0].answers.urgency, 'In den nächsten Wochen', 'Fragebogen-Spalte gemappt');
assert.equal(parsed.tickets[0].phone, '41796000000', 'Handynummer gemappt');

const ds = buildDataset(parsed, scoring, PROJECT.features, PROJECT.sheet.utmRoles);

// --- UTM-Rollen: Kampagne aus utm_campaign, Anzeigengruppe aus utm_term,
//     Creative aus utm_content -----------------------------------------------
const roman = ds.leads.find((l) => l.email === 'roman@example.com');
assert.equal(roman.sourceType, 'paid', 'utm_medium=paid -> bezahlt');
assert.equal(roman.campaign, 'JP | RML 14. & 15.10. | WARM UP | CBO | 101026', 'Kampagne aus utm_campaign');
assert.equal(roman.adset, 'JP | Broad | CH | 30+', 'Anzeigengruppe aus utm_term');
assert.equal(roman.creative, 'Video Hook A', 'Creative aus utm_content');

// --- Zweite Stufe: Umfrage-Zeile = Gold-Ticket, über die E-Mail gejoint -----
assert.equal(roman.hasTicket, true, 'Umfrage-Zeile zählt als Gold-Ticket');
assert.equal(roman.ticketAt, '2026-09-11T22:42:45.000Z', 'Ticket-Zeitpunkt aus dem Umfrage-Tab');
assert.equal(ds.counts.tickets, 2, 'zwei Tickets');

const anna = ds.leads.find((l) => l.email === 'anna@example.com');
assert.equal(anna.hasTicket, false, 'Lead ohne Umfrage bleibt Lead');
assert.equal(anna.creative, 'Static 2', 'zweites Creative getrennt attribuiert');

// --- Organisch --------------------------------------------------------------
const orga = ds.leads.find((l) => l.email === 'orga@example.com');
assert.equal(orga.sourceType, 'organic', 'ManyChat -> organisch');

// --- Einstufung: die festgelegten Geschäftsregeln --------------------------
// Roman: 2.000–2.999 € -> C, obwohl die Dringlichkeit hoch ist.
const q = roman.quality;
assert.ok(q, 'Qualität berechnet');
assert.equal(q.breakdown.income, 45, 'Einkommen 2.000–2.999 € -> Stufe 0.45');
assert.equal(q.tier, 'B', '2.000–2.999 € + hohe Dringlichkeit = B-Lead');

// Beat: 3.000–3.999 €, sonst schwache Antworten -> trotzdem A.
const beat = ds.leads.find((l) => l.email === 'beat@example.com');
assert.equal(beat.hasTicket, true);
assert.equal(beat.quality.breakdown.income, 100, 'Einkommen 3.000–3.999 € -> volle Stufe');
assert.equal(beat.quality.tier, 'A', 'über 3.000 € = A-Lead, unabhängig von den übrigen Antworten');

// Vollständige Matrix der echten Antwortoptionen gegen die Vorgabe:
//   über 3.000 €                                   -> A
//   2.000 - 2.999 € mit Kaufsignal (dringend ODER
//     selbstständig)                                -> B
//   2.000 - 2.999 € ohne Kaufsignal                 -> C
//   unter 2.000 €                                   -> D
//   Rentner/Schüler/Arbeitssuchend/über 60          -> D (schlägt alles)
const tierOf = (answers) => computeQuality(answers, scoring)?.tier ?? null;
const INCOMES = ['Unter 1.999 €', '2.000 - 2.999 €', '3.000 - 3.999 €', '4.000 - 4.999 €', 'Über 5.000 €'];
const URGENCIES = ['Sofort', 'In den nächsten Wochen', 'In den nächsten Monaten', 'Irgendwann'];
const DRINGEND = ['Sofort', 'In den nächsten Wochen'];
const MITTELFELD = '2.000 - 2.999 €';

const expectedTier = (income, employment, urgency) => {
  if (income === MITTELFELD) {
    return DRINGEND.includes(urgency) || employment.toLowerCase().includes('selbstständig') ? 'B' : 'C';
  }
  return income === 'Unter 1.999 €' ? 'D' : 'A';
};

for (const income of INCOMES) {
  for (const employment of ['Angestellt', 'Selbstständig / Unternehmer']) {
    for (const urgency of URGENCIES) {
      for (const age of ['18-29 Jahre', '30-39 Jahre', '40-49 Jahre', '50-59 Jahre']) {
        const want = expectedTier(income, employment, urgency);
        assert.equal(
          tierOf({ income, employment, age, urgency }),
          want,
          `${income} / ${employment} / ${urgency} / ${age} -> ${want}`
        );
      }
    }
  }
}

// Disqualifikation schlägt jedes Einkommen und jedes Kaufsignal
for (const income of INCOMES) {
  for (const employment of ['Rentner', 'Schüler/Student', 'Arbeitssuchend']) {
    assert.equal(tierOf({ income, employment, age: '40-49 Jahre', urgency: 'Sofort' }), 'D', `${employment} -> immer D`);
  }
  assert.equal(tierOf({ income, employment: 'Selbstständig / Unternehmer', age: 'Über 60 Jahre', urgency: 'Sofort' }), 'D', 'über 60 -> immer D');
}

// --- Qualifiziert zählt nur A: die beiden echten Leads aus dem Sheet ------
assert.deepEqual(qualifiedTiersOf(scoring), ['A'], 'nur A gilt als qualifiziert');
const tickets = ds.leads.filter((l) => l.hasTicket);
const qualified = tickets.filter((l) => qualifiedTiersOf(scoring).includes(l.quality?.tier));
assert.equal(tickets.length, 2, 'zwei Gold-Tickets');
assert.equal(qualified.length, 1, 'nur der A-Lead zählt als qualifiziert, der B-Lead nicht');

// Disqualifikation greift auch ohne Einkommens-Angabe
assert.equal(tierOf({ employment: 'Rentner' }), 'D', 'Rentner ohne Einkommens-Angabe -> D');
// Ohne jede bewertbare Antwort gibt es kein Urteil (statt einer erfundenen Note)
assert.equal(computeQuality({ challenge: 'Keine Struktur' }, scoring), null, 'ohne Einkommen keine Note');

console.log('✓ Projekt-Konfiguration passt zum Sheet');
console.log(`  ${PROJECT.name} | Ticket-Begriff: ${PROJECT.labels.ticket.many} | Leads: ${ds.counts.leads}, Tickets: ${ds.counts.tickets}`);
console.log('  Einstufung: über 3.000 € -> A · Mittelfeld mit Kaufsignal -> B · Mittelfeld ohne -> C · unter 2.000 €/Rentner/Ü60 -> D');
console.log('  (alle Kombinationen aus Einkommen x Beruf x Dringlichkeit x Alter geprüft)');
