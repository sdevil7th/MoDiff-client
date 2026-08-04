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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ModiffSnackbarProvider>
      <ControlStateMatrix />
    </ModiffSnackbarProvider>
  </StrictMode>,
);
