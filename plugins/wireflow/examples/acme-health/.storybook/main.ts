import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';

// Storybook für das Beispiel: die Screens aus .wireflow/screens (ihre Zustände sind Stories)
// und Komponenten von Acme UI. Wireflow-Screens importieren @wireflow/runtime – hier auf die
// Laufzeit des Plugins umgeleitet. Der Canvas zeigt dieses Storybook im Storybook-Brett.
const runtime = fileURLToPath(new URL('../../../src/runtime/index.js', import.meta.url));

const config: StorybookConfig = {
  stories: ['../.wireflow/screens/*.stories.tsx', '../packages/acme-ui/src/*.stories.tsx'],
  framework: '@storybook/react-vite',
  viteFinal: async base => {
    const { mergeConfig } = await import('vite');
    return mergeConfig(base, { resolve: { alias: { '@wireflow/runtime': runtime } } });
  },
};
export default config;
