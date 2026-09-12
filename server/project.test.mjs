/**
 * Prüft die AKTUELLE Projekt-Konfiguration (config/project.config.json) gegen
 * den echten Aufbau des Tracking-Sheets: Tabellen-Erkennung, Spalten-Mapping,
 * UTM-Rollen und das Scoring-Modell. Schlägt fehl, sobald Config und Sheet
 * auseinanderlaufen. Ausführen: node server/project.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSheets } from './parser.js';
import { buildDataset } from './build.js';
import { loadScoringConfig } from './scoring.js';
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
  ],
};

const umfrageSheet = {
  title: 'Online-Workshop Umfrage',
  values: [
    ['Datum Eintragung', 'Vorname', 'Nachname', 'E-Mail', 'Handynummer', 'Berufsbezeichnung', 'Alter', 'Größte Herausforderung', 'Dringlichkeit Lösung', 'Einkommen', 'Erwartung an Workshop', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'],
    ['0', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['2026-09-11 22:42:45', 'Roman', 'Huber', 'roman@example.com', '41796000000', 'Angestellt', '40-49 Jahre', 'Allem gerecht werden', 'In den nächsten Wochen', '2.000 - 2.999 €', 'Ich möchte weiterkommen', 'meta', 'paid', 'JP | RML 14. & 15.10. | WARM UP | CBO | 101026', 'JP | Broad | CH | 30+', 'Video Hook A'],
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

assert.equal(parsed.leads.length, 3, 'drei Leads erkannt (Zählzeile ignoriert)');
assert.equal(parsed.tickets.length, 1, 'eine Umfrage-Zeile erkannt');
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
assert.equal(ds.counts.tickets, 1, 'genau ein Ticket');

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
const expected = Math.round((0.45 * 0.45 + 0.9 * 0.35 + 0.7 * 0.2) * 100);
assert.equal(q.score, expected, `Gesamtscore = gewichtetes Mittel (${expected})`);
assert.ok(['A', 'B', 'C', 'D'].includes(q.tier), 'Tier zugeordnet');

console.log('✓ Projekt-Konfiguration passt zum Sheet');
console.log(`  ${PROJECT.name} | Ticket-Begriff: ${PROJECT.labels.ticket.many} | Leads: ${ds.counts.leads}, Tickets: ${ds.counts.tickets}, Score Roman: ${q.score} (${q.tier})`);
