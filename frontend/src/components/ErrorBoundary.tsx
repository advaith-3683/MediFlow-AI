import { Component, type ErrorInfo, type ReactNode } from "react";
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Deliberately avoid logging potentially sensitive render state. */ }
  render() { return this.state.failed ? <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center"><div><p className="font-bold text-blue-600">MediFlow AI</p><h1 className="mt-2 text-3xl font-bold">Something went wrong</h1><p className="mt-3 text-slate-600">Your data was not changed. Refresh the page and try again.</p><button onClick={() => window.location.reload()} className="mt-6 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white">Reload</button></div></main> : this.props.children; }
}
