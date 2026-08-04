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
