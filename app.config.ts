// Derived from cubiq/Mellon-client and modified by the MoDiff project.

const serverAddress = import.meta.env.VITE_SERVER_ADDRESS || window.location.origin;

function backendAddress() {
  if (import.meta.env.VITE_BACKEND_PROXY_TARGET) {
    return import.meta.env.VITE_BACKEND_PROXY_TARGET;
  }
  if (!import.meta.env.DEV) {
    return serverAddress;
  }
  try {
    const url = new URL(serverAddress);
    url.protocol = 'http:';
    url.port = '8088';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.origin;
  } catch {
    return serverAddress;
  }
}

function supervisorAddress() {
  if (import.meta.env.VITE_SUPERVISOR_CONTROL_ADDRESS) {
    return import.meta.env.VITE_SUPERVISOR_CONTROL_ADDRESS;
  }
  const backend = backendAddress();
  try {
    const url = new URL(backend);
    const backendPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    url.protocol = 'http:';
    url.port = String(backendPort + 1);
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.origin;
  } catch {
    return backend;
  }
}

const config = {
  serverAddress,
  supervisorAddress: supervisorAddress(),
};

export default config;
