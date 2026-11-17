import React from "react";
export class CrashBoundary extends React.Component<
  React.PropsWithChildren,
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="bg-gray-950 text-gray-200 min-h-screen p-8 select-text">
        <h1 className="text-2xl">Cairn IDE encountered a UI error</h1>
        <p className="my-4">
          The editor could not continue rendering. Copy these details before
          reloading. Unsaved changes may be lost.
        </p>
        <pre className="whitespace-pre-wrap">
          {this.state.error.stack || this.state.error.message}
        </pre>
        <button
          className="bg-blue-800 p-3 mt-4"
          onClick={() => location.reload()}
        >
          Reload Cairn IDE
        </button>
      </main>
    );
  }
}
