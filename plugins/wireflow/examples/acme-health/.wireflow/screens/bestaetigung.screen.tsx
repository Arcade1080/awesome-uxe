import { Page, SummaryList, Spacer, Button } from '@acme/ui';
import { flow } from '@wireflow/runtime';
import { SuccessMark } from '../../src/components/SuccessMark';
import type { Bestaetigung } from '../fixtures/termin';

export function BestaetigungScreen({ termin, details }: Bestaetigung) {
  return (
    <Page data-wf="page" padding="space.4" gap="space.3">
      <SuccessMark data-wf="ok" title="Termin gebucht" text={termin} />
      <SummaryList data-wf="sum" items={details} />
      <Spacer data-wf="spacer" />
      <Button data-wf="btn_kal" variant="secondary" size="lg" onPress={flow.trigger('btn_kal')}>In Kalender eintragen</Button>
      <Button data-wf="btn_fertig" variant="primary" size="lg" onPress={flow.trigger('btn_fertig')}>Fertig</Button>
    </Page>
  );
}
