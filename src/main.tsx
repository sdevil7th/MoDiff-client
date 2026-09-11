// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WebsocketProvider } from './components/WebsocketProvider.tsx';
import { ReactFlowProvider } from '@xyflow/react';
import App from './App.tsx';

import '@fontsource/source-sans-pro/latin-400.css';
import '@fontsource/source-sans-pro/latin-600.css';
import '@fontsource/source-sans-pro/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-700.css';
import '@xyflow/react/dist/base.css';
import './theme/modiff.css';
import './App.css';
import { ModiffSnackbarProvider } from './ui/ModiffSnackbarProvider';

// React Flow and the browser deliver resize measurements in separate phases.
// A deliberate node resize can therefore produce Chromium's non-fatal
// ResizeObserver delivery diagnostic even though the next animation frame
// resolves every measurement. Prevent only those browser-defined diagnostics
// from becoming an unhandled-error overlay; application exceptions and run
// failures continue through the normal error surfaces.
const benignResizeObserverMessages = new Set([
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications.',
]);
window.addEventListener(
  'error',
  (event) => {
    if (!benignResizeObserverMessages.has(event.message)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ModiffSnackbarProvider>
      <WebsocketProvider>
        <ReactFlowProvider>
          <App />
        </ReactFlowProvider>
      </WebsocketProvider>
    </ModiffSnackbarProvider>
  </StrictMode>,
);
