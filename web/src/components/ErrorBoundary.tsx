import React from 'react';

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: 'Aplikace narazila na chybu.',
  };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    if (error instanceof Error && error.message) {
      return { hasError: true, message: `Aplikace narazila na chybu: ${error.message}` };
    }
    return { hasError: true, message: 'Aplikace narazila na chybu.' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled application error', { error, info });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="app-error-boundary" role="alert">
        <div className="app-error-boundary__card">
          <h1>Aplikace narazila na chybu</h1>
          <p>{this.state.message}</p>
          <button type="button" onClick={this.handleReload}>
            Obnovit aplikaci
          </button>
        </div>
      </div>
    );
  }
}
