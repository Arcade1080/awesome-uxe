import { Page, AppBar, SummaryList, Select, Checkbox, Spacer, Button } from '@acme/ui';
import { flow } from '@wireflow/runtime';
import type { Pruefen } from '../fixtures/termin';

export function AngabenPruefenScreen({ zusammenfassung, grund }: Pruefen) {
  return (
    <Page data-wf="page" padding="space.4" gap="space.3">
      <AppBar data-wf="ab" title="Angaben prüfen" onBack={flow.back} />
      <SummaryList data-wf="sum" items={zusammenfassung} />
      <Select data-wf="s_grund" label="Grund des Besuchs" value={grund} options={['Hautausschlag', 'Kontrolle', 'Sonstiges']} />
      <Checkbox data-wf="cb_erinnerung" label="Erinnerung 24 Stunden vorher" defaultChecked />
      <Spacer data-wf="spacer" />
      <Button data-wf="btn_buchen" variant="primary" size="lg" onPress={flow.trigger('btn_buchen')}>Verbindlich buchen</Button>
    </Page>
  );
}
