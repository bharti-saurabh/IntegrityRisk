import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Do not silently swallow — surface to console for debugging.
    console.error("[IICC] Render error:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-6 rounded-xl border border-critical/40 bg-critical/10 p-6">
          <div className="text-sm font-semibold text-critical">Something went wrong rendering this view.</div>
          <div className="mt-2 font-mono text-xs text-ink-2">{this.state.error.message}</div>
          <button
            className="mt-4 rounded-lg border border-border px-3 py-1.5 text-xs text-ink-2 hover:text-ink"
            onClick={() => this.setState({ error: null })}
          >
            Dismiss
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
