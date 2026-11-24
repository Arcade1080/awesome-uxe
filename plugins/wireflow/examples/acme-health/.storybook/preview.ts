import type { Preview } from '@storybook/react-vite';
import './acme-tokens.css';
import '@acme/ui/styles.css';

// Screens füllen den Frame; Komponenten-Stories setzen ihr eigenes Layout.
const preview: Preview = { parameters: { layout: 'fullscreen' } };
export default preview;
