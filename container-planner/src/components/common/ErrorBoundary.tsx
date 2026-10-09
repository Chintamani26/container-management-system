import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors anywhere below it and shows a recoverable message instead of an
 * uncaught exception unmounting the whole app (which otherwise leaves a blank page — see the
 * Viewer-role infinite-render incident this was added after).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Container Planner crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 p-8 text-center">
        <AlertOctagon className="h-10 w-10 text-red-500" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
        <p className="max-w-md text-sm text-slate-500">{this.state.error.message}</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Try Again
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
