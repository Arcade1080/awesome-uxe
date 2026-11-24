import type { Meta, StoryObj } from '@storybook/react';
import { ErgebnisseScreen } from './ergebnisse.screen';
import { termin } from '../fixtures/termin';

const meta = { title: 'Termin buchen/ergebnisse', component: ErgebnisseScreen } satisfies Meta<typeof ErgebnisseScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = { args: termin.ergebnisse };
