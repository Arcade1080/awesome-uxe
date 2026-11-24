import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './index';

const meta = {
  title: 'Acme UI/Button',
  component: Button,
  args: { children: 'Termin buchen' },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary' } };
export const Secondary: Story = { args: { variant: 'secondary' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
