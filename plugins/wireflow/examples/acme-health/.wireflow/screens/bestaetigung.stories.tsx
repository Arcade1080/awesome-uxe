import type { Meta, StoryObj } from '@storybook/react';
import { BestaetigungScreen } from './bestaetigung.screen';
import { termin } from '../fixtures/termin';

const meta = { title: 'Termin buchen/bestaetigung', component: BestaetigungScreen } satisfies Meta<typeof BestaetigungScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = { args: termin.bestaetigung };
