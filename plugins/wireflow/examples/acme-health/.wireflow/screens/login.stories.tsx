import type { Meta, StoryObj } from '@storybook/react';
import { AnmeldenScreen } from './login.screen';
import { termin } from '../fixtures/termin';

const meta = { title: 'Termin buchen/login', component: AnmeldenScreen } satisfies Meta<typeof AnmeldenScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = { args: termin.anmeldung };
