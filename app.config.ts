// Derived from cubiq/Mellon-client and modified by the MoDiff project.

const serverAddress = import.meta.env.VITE_SERVER_ADDRESS || window.location.origin;
// Vite supplies a derived development value too; only the operator's
// override can describe a nonadjacent tunneled supervisor destination.
const supervisorAddressExplicit =
  import.meta.env.MODIFF_SUPERVISOR_CONTROL_EXPLICIT ?? Boolean(import.meta.env.VITE_SUPERVISOR_CONTROL_ADDRESS);

function backendAddress() {
  if (!import.meta.env.DEV || import.meta.env.VITE_SERVER_ADDRESS) {
    return serverAddress;
  }
  if (import.meta.env.VITE_BACKEND_PROXY_TARGET) {
    return import.meta.env.VITE_BACKEND_PROXY_TARGET;
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

const backendTransportAddress = backendAddress();

function supervisorAddress() {
  if (supervisorAddressExplicit && import.meta.env.VITE_SUPERVISOR_CONTROL_ADDRESS) {
    return import.meta.env.VITE_SUPERVISOR_CONTROL_ADDRESS;
  }
  const backend = backendTransportAddress;
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
  backendAddress: backendTransportAddress,
  supervisorAddress: supervisorAddress(),
  supervisorAddressExplicit,
};

export default config;
