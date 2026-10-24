// Catches a crash inside one page so the rest of the screen (header, menu) keeps working.
// `resetKey` (e.g. the URL) clears the error when the user goes somewhere else.
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null, key: props.resetKey }; }

  static getDerivedStateFromError(error) { return { error }; }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error, info) { console.error('Page crashed:', error, info?.componentStack); }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card stack g8" role="alert">
        <strong>This part of the page couldn’t be shown.</strong>
        <span className="small muted">Something went wrong while showing it. The rest of the console still works.</span>
        <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
