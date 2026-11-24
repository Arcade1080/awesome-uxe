import type { Meta, StoryObj } from '@storybook/react';
import { AngabenPruefenScreen } from './pruefen.screen';
import { termin } from '../fixtures/termin';

const meta = { title: 'Termin buchen/pruefen', component: AngabenPruefenScreen } satisfies Meta<typeof AngabenPruefenScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = { args: termin.pruefen };
