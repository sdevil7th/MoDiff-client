import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/source-sans-pro/latin-400.css';
import '@fontsource/source-sans-pro/latin-600.css';
import '@fontsource/source-sans-pro/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-700.css';
import '../theme/modiff.css';
import { ControlStateMatrix } from './ControlStateMatrix';
import { ModiffSnackbarProvider } from './ModiffSnackbarProvider';
import { NodeFieldLayoutFixture } from './NodeFieldLayoutFixture';
import { useStudioStore } from '../stores/useStudioStore';

const fieldLayout = new URLSearchParams(window.location.search).has('node-field-layout');
if (fieldLayout) useStudioStore.setState({ form: { ...useStudioStore.getState().form, resourceMode: 'auto' } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ModiffSnackbarProvider>{fieldLayout ? <NodeFieldLayoutFixture /> : <ControlStateMatrix />}</ModiffSnackbarProvider>
  </StrictMode>,
);
