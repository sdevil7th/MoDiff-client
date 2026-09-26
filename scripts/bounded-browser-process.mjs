import { spawn } from 'node:child_process';

// Own only this browser runner and its descendants, never the model server.
// A deadline must remain effective even when the immediate child exits first.
export function runBoundedBrowser(command, args, { env, timeoutMs = 21 * 60_000, graceMs = 15_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', detached: process.platform !== 'win32', env });
    let timedOut = false;
    let settled = false;
    let force;
    const terminate = (signal) => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        // child.kill() alone leaves Playwright's browser/web-server alive.
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        killer.on('error', () => child.kill());
        killer.unref();
      } else {
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') console.error(`Browser process cleanup: ${error.message}`);
        }
      }
    };
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(force);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      resolve({ code, timedOut });
    };
    const expire = () => {
      if (timedOut) return;
      timedOut = true;
      terminate('SIGTERM');
      force = setTimeout(() => {
        terminate('SIGKILL');
        child.unref();
        finish(124);
      }, graceMs);
    };
    const interrupt = () => {
      // Still give the caller a chance to persist its failure receipt.
      process.exitCode = 130;
      expire();
    };
    const deadline = setTimeout(expire, timeoutMs);
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    child.once('error', (error) => finish(String(error)));
    child.once('exit', (code, signal) => {
      if (timedOut) return; // Keep the group-kill deadline after parent exit.
      if (process.platform !== 'win32') terminate('SIGKILL');
      finish(code ?? signal ?? 1);
    });
  });
}
