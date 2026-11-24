import { Page, AppBar, ChipGroup, Text, Card, Avatar } from '@acme/ui';
import { flow } from '@wireflow/runtime';
import type { Ergebnisse } from '../fixtures/termin';

export function ErgebnisseScreen({ ort, anzahl, praxen }: Ergebnisse) {
  return (
    <Page data-wf="page" padding="space.4" gap="space.3">
      <AppBar data-wf="ab" title="Dermatologie" subtitle={`${ort} · diese Woche`} onBack={flow.back} />
      <ChipGroup data-wf="ch_sort" options={['Nächster Termin', 'Entfernung', 'Bewertung']} defaultValue="Nächster Termin" />
      <Text data-wf="tx_n" tone="muted">{anzahl} Praxen mit freien Terminen</Text>
      <Card data-wf="card_klein" title={praxen[0].name} subtitle={praxen[0].fach} meta={praxen[0].bewertung} badge={praxen[0].naechster} media={<Avatar initials={praxen[0].kuerzel} />} onPress={flow.trigger('card_klein')} />
      <Card data-wf="card_park" title={praxen[1].name} subtitle={praxen[1].fach} meta={praxen[1].bewertung} badge={praxen[1].naechster} media={<Avatar initials={praxen[1].kuerzel} />} />
      <Card data-wf="card_weber" title={praxen[2].name} subtitle={praxen[2].fach} meta={praxen[2].bewertung} badge={praxen[2].naechster} media={<Avatar initials={praxen[2].kuerzel} />} />
    </Page>
  );
}
