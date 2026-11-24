import { Page, AppBar, Card, Avatar, ChipGroup, Text, Spacer, Button } from '@acme/ui';
import { flow } from '@wireflow/runtime';
import type { TerminAuswahl } from '../fixtures/termin';

export function ProfilTermineScreen({ arzt, tage, zeiten }: TerminAuswahl) {
  return (
    <Page data-wf="page" padding="space.4" gap="space.3">
      <AppBar data-wf="ab" title="Termin wählen" onBack={flow.back} />
      <Card data-wf="card_arzt" title={arzt.name} subtitle={`${arzt.fach} · ${arzt.adresse}`} meta="Kassenpatient:innen willkommen" media={<Avatar initials={arzt.kuerzel} />} />
      <ChipGroup data-wf="ch_tag" label="Tag" options={tage} defaultValue={tage[2]} />
      <ChipGroup data-wf="ch_uhr" label="Uhrzeit" options={zeiten} defaultValue={zeiten[1]} />
      <Text data-wf="tx_res" tone="muted" icon="clock">Wir halten den Termin 5 Minuten für Sie frei.</Text>
      <Spacer data-wf="spacer" />
      <Button data-wf="btn_weiter" variant="primary" size="lg" onPress={flow.trigger('btn_weiter')}>Weiter</Button>
    </Page>
  );
}
