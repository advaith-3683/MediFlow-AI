import AppRouter from "./routes/AppRouter";
import { AuthProvider } from "./auth/AuthContext";
import ErrorBoundary from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ui/Toast";
import { I18nProvider } from "./i18n/I18nContext";

function App() {
  return <ErrorBoundary><I18nProvider><ToastProvider><AuthProvider><AppRouter /></AuthProvider></ToastProvider></I18nProvider></ErrorBoundary>;
}

export default App;
