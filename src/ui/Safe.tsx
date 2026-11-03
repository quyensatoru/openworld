// Error boundaries: one broken overlay must never take the whole office down (a white screen).
// <Safe> hides a crashed piece of HUD for a moment and tries again; <RootSafe> is the last resort.
import { Component, type ReactNode } from 'react';

export class Safe extends Component<{ children: ReactNode }, { err: boolean }> {
  state = { err: false };
  private retry: ReturnType<typeof setTimeout> | null = null;
  static getDerivedStateFromError() {
    return { err: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[ui] overlay crashed, hiding it for a moment', error);
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => this.setState({ err: false }), 2500);
  }
  componentWillUnmount() {
    if (this.retry) clearTimeout(this.retry);
  }
  render() {
    return this.state.err ? null : this.props.children;
  }
}

export class RootSafe extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(error: unknown) {
    console.error('[ui] app crashed', error);
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="crash-card">
        <div>
          <h2>😵 Có lỗi hiển thị</h2>
          <p>Văn phòng gặp lỗi khi vẽ giao diện. Tải lại trang thường sẽ khắc phục được.</p>
          <code>{this.state.err}</code>
          <button className="btn primary" onClick={() => location.reload()}>
            🔄 Tải lại
          </button>
        </div>
      </div>
    );
  }
}
