import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', padding: '2rem', fontFamily: 'system-ui, sans-serif',
          backgroundColor: '#0f172a', color: '#e2e8f0',
        }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>
            Ein unerwarteter Fehler ist aufgetreten
          </h1>
          <p style={{ color: '#94a3b8', marginBottom: '1.5rem', maxWidth: '400px', textAlign: 'center' }}>
            Die Anwendung hat einen Fehler festgestellt. Bitte laden Sie die Seite neu.
          </p>
          <pre style={{
            backgroundColor: '#1e293b', padding: '1rem', borderRadius: '0.5rem',
            fontSize: '0.75rem', color: '#f87171', maxWidth: '600px', overflow: 'auto',
            marginBottom: '1.5rem',
          }}>
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1.5rem', backgroundColor: '#3b82f6', color: 'white',
              border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontSize: '0.875rem',
            }}
          >
            Seite neu laden
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
