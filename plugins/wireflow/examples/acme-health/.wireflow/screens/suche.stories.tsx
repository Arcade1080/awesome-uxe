import type { Meta, StoryObj } from '@storybook/react';
import { SucheScreen } from './suche.screen';
import { termin } from '../fixtures/termin';

const meta = { title: 'Termin buchen/suche', component: SucheScreen } satisfies Meta<typeof SucheScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = { args: termin.suche };
