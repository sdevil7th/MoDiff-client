import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children?: ReactNode;
  module?: string;
  action?: string;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, { hasError: boolean }> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-[480px] border border-modiff-red px-3 py-2 text-sm text-modiff-red">
          <p>
            Something went wrong while rendering module `{this.props.module}` action `{this.props.action}`. Please check
            the browser console and report the incident.
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
