// Graph construction grows renderer-owned UI state even though workflow
// persistence is ephemeral. Keep batches far below the observed 134-graph
// renderer crash while avoiding a browser restart for every workflow.
export const DEFAULT_WORKFLOW_BROWSER_BATCH_SIZE = 20;
export const DEFAULT_WORKFLOW_BROWSER_OPERATION_TIMEOUT_MS = 120_000;
export const DEFAULT_WORKFLOW_BROWSER_CLOSE_TIMEOUT_MS = 5_000;

const SESSION_ERROR_CODES = new Set([
  'browser_close_incomplete',
  'browser_close_timeout',
  'browser_disconnected',
  'browser_launch_failed',
  'operation_timeout',
  'page_closed',
  'page_crashed',
  'session_disposed',
]);

export class WorkflowBrowserSessionError extends Error {
  constructor(code, message, operation = null) {
    super(operation ? `${message} while ${operation}.` : `${message}.`);
    this.name = 'WorkflowBrowserSessionError';
    this.code = code;
    this.operation = operation;
  }
}

export function isWorkflowBrowserSessionError(error) {
  return error instanceof WorkflowBrowserSessionError || SESSION_ERROR_CODES.has(error?.code);
}

export function parseWorkflowBrowserBatchSize(value) {
  if (value === undefined || value === '') return DEFAULT_WORKFLOW_BROWSER_BATCH_SIZE;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error('MODIFF_WORKFLOW_BROWSER_BATCH_SIZE must be an integer from 1 through 100.');
  }
  return parsed;
}

export function shouldRecycleWorkflowBrowser(completedInSession, batchSize) {
  if (!Number.isSafeInteger(completedInSession) || completedInSession < 0) {
    throw new Error('The completed workflow count must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error('The workflow browser batch size must be a positive integer.');
  }
  return completedInSession >= batchSize;
}

export async function launchWorkflowBrowser(
  launch,
  { attempts = 3, retryDelayMs = 500, sessionLabel = 'canonical workflow' } = {},
) {
  if (typeof launch !== 'function') throw new Error('The workflow browser launcher must be callable.');
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 5) {
    throw new Error('Workflow browser launch attempts must be an integer from 1 through 5.');
  }
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 5_000) {
    throw new Error('Workflow browser launch retry delay must be between 0 and 5000 ms.');
  }
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await launch();
    } catch (error) {
      lastError = error;
      if (attempt < attempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  const detail = lastError instanceof Error && lastError.message ? `: ${lastError.message}` : '';
  throw new WorkflowBrowserSessionError(
    'browser_launch_failed',
    `The ${sessionLabel} browser failed to launch after ${attempts} attempts${detail}`,
  );
}

export function createWorkflowBrowserSessionGuard({
  browser,
  page,
  operationTimeoutMs = DEFAULT_WORKFLOW_BROWSER_OPERATION_TIMEOUT_MS,
  sessionLabel = 'canonical workflow',
}) {
  if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 1) {
    throw new Error('The workflow browser operation timeout must be a positive integer.');
  }

  let disposed = false;
  let terminalError = null;
  let rejectTermination;
  const termination = new Promise((_, reject) => {
    rejectTermination = reject;
  });
  // A renderer can crash between operations. Keep that terminal rejection
  // observed until the next guarded operation synchronously reads it.
  termination.catch(() => undefined);

  const terminate = (code, message) => {
    if (disposed || terminalError) return;
    terminalError = new WorkflowBrowserSessionError(code, message);
    rejectTermination(terminalError);
  };
  const onPageCrash = () => terminate('page_crashed', `The ${sessionLabel} renderer crashed`);
  const onPageClose = () => terminate('page_closed', `The ${sessionLabel} page closed unexpectedly`);
  const onBrowserDisconnected = () =>
    terminate('browser_disconnected', `The ${sessionLabel} browser disconnected unexpectedly`);

  page.on('crash', onPageCrash);
  page.on('close', onPageClose);
  browser.on('disconnected', onBrowserDisconnected);

  return {
    get terminalError() {
      return terminalError;
    },
    async run(operation, action, timeoutMs = operationTimeoutMs) {
      if (disposed) {
        throw new WorkflowBrowserSessionError(
          'session_disposed',
          `The ${sessionLabel} browser session ended`,
          operation,
        );
      }
      if (terminalError) {
        throw new WorkflowBrowserSessionError(terminalError.code, terminalError.message.replace(/\.$/, ''), operation);
      }
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
        throw new Error('The workflow browser operation timeout must be a positive integer.');
      }

      let timeout;
      const bounded = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = new WorkflowBrowserSessionError(
            'operation_timeout',
            `The ${sessionLabel} browser exceeded ${timeoutMs} ms`,
            operation,
          );
          if (!terminalError) {
            terminalError = error;
            rejectTermination(error);
          }
          reject(error);
        }, timeoutMs);
      });
      try {
        return await Promise.race([Promise.resolve().then(() => action(page)), termination, bounded]);
      } finally {
        clearTimeout(timeout);
      }
    },
    assertHealthy(operation) {
      if (disposed) {
        throw new WorkflowBrowserSessionError(
          'session_disposed',
          `The ${sessionLabel} browser session ended`,
          operation,
        );
      }
      if (terminalError) {
        throw new WorkflowBrowserSessionError(terminalError.code, terminalError.message.replace(/\.$/, ''), operation);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      page.off('crash', onPageCrash);
      page.off('close', onPageClose);
      browser.off('disconnected', onBrowserDisconnected);
    },
  };
}

export async function closeWorkflowBrowser(
  browser,
  timeoutMs = DEFAULT_WORKFLOW_BROWSER_CLOSE_TIMEOUT_MS,
  sessionLabel = 'canonical workflow',
) {
  if (!browser) return;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('The workflow browser close timeout must be a positive integer.');
  }
  let timeout;
  const close = Promise.resolve().then(() => browser.close());
  try {
    await Promise.race([
      close,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new WorkflowBrowserSessionError(
                'browser_close_timeout',
                `The ${sessionLabel} browser did not close within ${timeoutMs} ms`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  if (typeof browser.isConnected === 'function' && browser.isConnected()) {
    throw new WorkflowBrowserSessionError(
      'browser_close_incomplete',
      `The ${sessionLabel} browser remained connected after close`,
    );
  }
}
