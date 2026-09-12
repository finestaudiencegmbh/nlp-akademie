/**
 * Prüft die AKTUELLE Projekt-Konfiguration (config/project.config.json) gegen
 * den echten Aufbau des Tracking-Sheets: Tabellen-Erkennung, Spalten-Mapping,
 * UTM-Rollen und das Scoring-Modell. Schlägt fehl, sobald Config und Sheet
 * auseinanderlaufen. Ausführen: node server/project.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSheets } from './parser.js';
import { buildDataset } from './build.js';
import { loadScoringConfig, computeQuality } from './scoring.js';
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
    ['2026-09-12 09:35:00', 'Beat', 'Keller', 'beat@example.com', '41790000000', 'Arbeitssuchend', '50-59 Jahre', 'Keine Struktur', 'Irgendwann', '3.000 - 3.999 €', 'Mal reinschauen', 'meta', 'paid', 'JP | RML 14. & 15.10. | WARM UP | CBO | 101026', 'JP | Broad | CH | 30+', 'Static 2'],
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

// --- Scoring: Einkommen + Dringlichkeit + Beruf ----------------------------
const q = roman.quality;
assert.ok(q, 'Qualität berechnet');
assert.equal(q.breakdown.income, 45, 'Einkommen 2.000–2.999 € -> Stufe 0.45');
assert.equal(q.breakdown.urgency, 90, 'Dringlichkeit "In den nächsten Wochen" -> 0.9');
assert.equal(q.breakdown.employment, 70, 'Berufsbezeichnung "Angestellt" -> 0.7');
const w = scoring.weights;
const expected = Math.round((0.45 * w.income + 0.9 * w.urgency + 0.7 * w.employment) * 100);
assert.equal(q.score, expected, `Gesamtscore = gewichtetes Mittel (${expected})`);

// --- LEITREGEL: über 3.000 € Einkommen ist immer A ------------------------
// Beat hat die schwächsten Antworten außer beim Einkommen – trotzdem A.
const beat = ds.leads.find((l) => l.email === 'beat@example.com');
assert.equal(beat.hasTicket, true);
assert.equal(beat.quality.breakdown.income, 100, 'Einkommen 3.000–3.999 € -> volle Stufe');
assert.equal(beat.quality.tier, 'A', 'über 3.000 € = A-Lead, unabhängig von den übrigen Antworten');
assert.ok(beat.quality.score >= 75, 'Score über der A-Schwelle');

// Gegenprobe: unter 3.000 € darf auch mit Bestwerten überall nicht A werden
const bestUnder3k = computeQuality({ income: '2.000 - 2.999 €', urgency: 'Sofort', employment: 'Unternehmer' }, scoring);
assert.notEqual(bestUnder3k.tier, 'A', 'unter 3.000 € kein A-Lead');

console.log('✓ Projekt-Konfiguration passt zum Sheet');
console.log(`  ${PROJECT.name} | Ticket-Begriff: ${PROJECT.labels.ticket.many} | Leads: ${ds.counts.leads}, Tickets: ${ds.counts.tickets}`);
console.log(`  Scoring: 2.000–2.999 € -> ${q.score} (${q.tier}) · 3.000–3.999 € -> ${beat.quality.score} (${beat.quality.tier})`);
