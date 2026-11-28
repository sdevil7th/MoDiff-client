// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { Component, ErrorInfo, ReactNode } from 'react';
import { ModiffButton } from '../ui';
import { useStudioStore } from '../stores/useStudioStore';

interface ErrorBoundaryProps {
  children?: ReactNode;
  module?: string;
  action?: string;
  nodeId?: string;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, { hasError: boolean; loadFailed: boolean }> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, loadFailed: false };
  }

  static getDerivedStateFromError(error: unknown) {
    const loadFailed =
      error instanceof Error &&
      (error.name === 'ChunkLoadError' ||
        /dynamically imported module|loading chunk|module script failed/i.test(error.message));
    return { hasError: true, loadFailed };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          id={this.props.nodeId}
          role="alert"
          className="max-w-[480px] border border-modiff-red px-3 py-2 text-sm text-modiff-red"
        >
          {this.state.loadFailed ? (
            <div data-node-load-error>
              <p>The controls for {this.props.action || 'this stage'} could not load.</p>
              <ModiffButton
                size="compact"
                className="mt-2"
                onClick={() => {
                  useStudioStore.getState().saveActiveWorkflowTab(true);
                  window.location.reload();
                }}
              >
                Reload workspace to retry
              </ModiffButton>
            </div>
          ) : (
            <p>
              Something went wrong while rendering module `{this.props.module}` action `{this.props.action}`. Please
              check the browser console and report the incident.
            </p>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
