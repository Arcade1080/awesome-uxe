import { Page, AppBar, Heading, Text, TextField, Spacer, Button } from '@acme/ui';
import { flow } from '@wireflow/runtime';
import type { Anmeldung } from '../fixtures/termin';

export function AnmeldenScreen({ email }: Anmeldung) {
  return (
    <Page data-wf="page" padding="space.4" gap="space.3">
      <AppBar data-wf="ab" title="Anmelden" onBack={flow.back} />
      <Heading data-wf="h" level={1}>Fast geschafft</Heading>
      <Text data-wf="tx" tone="muted">Melden Sie sich an, damit die Praxis Ihnen den Termin zuordnen kann.</Text>
      <TextField data-wf="f_mail" label="E-Mail" type="email" defaultValue={email} />
      <TextField data-wf="f_pw" label="Passwort" type="password" defaultValue="geheim123" />
      <Spacer data-wf="spacer" />
      <Button data-wf="btn_login" variant="primary" size="lg" onPress={flow.trigger('btn_login')}>Anmelden und weiter</Button>
      <Button data-wf="btn_gast" variant="ghost" size="lg" onPress={flow.trigger('btn_gast')}>Als Gast fortfahren</Button>
    </Page>
  );
}
