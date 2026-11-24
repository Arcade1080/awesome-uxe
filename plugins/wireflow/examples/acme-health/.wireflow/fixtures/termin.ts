// Typisierte Testdaten für die Screen-Module (fiktiv).
export type Suche = { fachrichtung: string; ort: string; versicherung: string; zeitraum: string[] };
export type Praxis = { name: string; kuerzel: string; fach: string; bewertung: string; naechster: string };
export type Ergebnisse = { ort: string; anzahl: number; praxen: Praxis[] };
export type TerminAuswahl = { arzt: { name: string; kuerzel: string; fach: string; adresse: string }; tage: string[]; zeiten: string[] };
export type Anmeldung = { email: string };
export type Pruefen = { zusammenfassung: [string, string][]; grund: string };
export type Bestaetigung = { termin: string; details: [string, string][] };

export const termin = {
  suche: { fachrichtung: 'Dermatologie', ort: '10437 Berlin', versicherung: 'Gesetzlich versichert', zeitraum: ['Diese Woche', 'Nächste Woche', 'Egal'] } satisfies Suche,
  ergebnisse: {
    ort: '10437 Berlin',
    anzahl: 12,
    praxen: [
      { name: 'Dr. Sara Klein', kuerzel: 'SK', fach: 'Dermatologie · 1,2 km', bewertung: '4,8 von 5 · 212 Bewertungen', naechster: 'Heute 16:40' },
      { name: 'Hautarztpraxis am Park', kuerzel: 'HP', fach: 'Dermatologie · 2,0 km', bewertung: '4,6 von 5 · 98 Bewertungen', naechster: 'Mi 09:15' },
      { name: 'Dr. Jonas Weber', kuerzel: 'JW', fach: 'Dermatologie · 3,4 km', bewertung: '4,9 von 5 · 301 Bewertungen', naechster: 'Do 11:00' },
    ],
  } satisfies Ergebnisse,
  auswahl: {
    arzt: { name: 'Dr. Sara Klein', kuerzel: 'SK', fach: 'Dermatologie', adresse: 'Lindenweg 12' },
    tage: ['Mo 23.', 'Di 24.', 'Mi 25.', 'Do 26.'],
    zeiten: ['08:30', '09:15', '11:00', '14:20'],
  } satisfies TerminAuswahl,
  anmeldung: { email: 'mara.k@example.org' } satisfies Anmeldung,
  pruefen: { zusammenfassung: [['Praxis', 'Dr. Sara Klein'], ['Termin', 'Mi, 25.11. · 09:15'], ['Versicherung', 'Gesetzlich']], grund: 'Hautausschlag' } satisfies Pruefen,
  bestaetigung: { termin: 'Mi, 25.11. um 09:15 bei Dr. Sara Klein', details: [['Adresse', 'Lindenweg 12'], ['Mitbringen', 'Versichertenkarte'], ['Erinnerung', 'Di, 24.11. · 09:15']] } satisfies Bestaetigung,
};
