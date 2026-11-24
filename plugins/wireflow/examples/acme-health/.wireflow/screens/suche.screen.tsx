import { Page, AppBar, Heading, TextField, Select, ChipGroup, Spacer, Button } from '@acme/ui';
import { flow } from '@wireflow/runtime';
import type { Suche } from '../fixtures/termin';

export function SucheScreen({ fachrichtung, ort, versicherung, zeitraum }: Suche) {
  return (
    <Page data-wf="page" padding="space.4" gap="space.3">
      <AppBar data-wf="ab" title="Termin finden" />
      <Heading data-wf="h" level={1}>Wobei brauchen Sie Hilfe?</Heading>
      <TextField data-wf="f_fach" label="Fachrichtung oder Beschwerde" defaultValue={fachrichtung} icon="search" />
      <TextField data-wf="f_ort" label="Ort oder PLZ" defaultValue={ort} icon="pin" />
      <Select data-wf="s_vers" label="Versicherung" value={versicherung} options={['Gesetzlich versichert', 'Privat versichert']} />
      <ChipGroup data-wf="ch_zeit" label="Zeitraum" options={zeitraum} defaultValue={zeitraum[0]} />
      <Spacer data-wf="spacer" />
      <Button data-wf="btn_suchen" variant="primary" size="lg" onPress={flow.trigger('btn_suchen')}>Ärzt:innen finden</Button>
    </Page>
  );
}
