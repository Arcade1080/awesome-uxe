import type { Meta, StoryObj } from '@storybook/react';
import { ProfilTermineScreen } from './profil.screen';
import { termin } from '../fixtures/termin';

const meta = { title: 'Termin buchen/profil', component: ProfilTermineScreen } satisfies Meta<typeof ProfilTermineScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = { args: termin.auswahl };
export const KeineTermine: Story = { args: { ...termin.auswahl, zeiten: [] } };
