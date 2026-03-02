import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[NekoAI] UI crash caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center h-full w-full">
          <div className="w-[480px] bg-white rounded-[var(--radius)] p-8 text-center" style={{ boxShadow: 'var(--shadow-3d)' }}>
            <span className="text-5xl block mb-4">😿</span>
            <h2 className="text-lg font-bold text-[var(--text-primary)] mb-2">界面出错了</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              别担心，你的数据不受影响。
            </p>
            <div className="text-left mb-4 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
              <p className="text-xs text-[var(--error)] mono break-all">{this.state.error.message}</p>
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => this.setState({ error: null })}
                className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--accent-purple)] text-white hover:opacity-90 transition-colors cursor-pointer"
              >
                重试
              </button>
              {this.props.onReset && (
                <button
                  onClick={() => {
                    this.setState({ error: null });
                    this.props.onReset?.();
                  }}
                  className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                >
                  重新选择目录
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
