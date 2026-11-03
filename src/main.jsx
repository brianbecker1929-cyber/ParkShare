import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import {shouldHydrateHomepage} from './lib/homeBootstrap.js';

// Catches crashes that happen after React has mounted (the inline script in
// index.html only catches crashes before mount). Without this, a render-time
// error anywhere in the tree unmounts everything and leaves a blank page.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("ParkShare crashed:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ fontFamily: "monospace", padding: 24, color: "#b00020", background: "#fff3f3", minHeight: "100vh", boxSizing: "border-box" }}>
          <h2 style={{ marginTop: 0 }}>ParkShare crashed</h2>
          <p style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{String(this.state.error && this.state.error.message || this.state.error)}</p>
          <p style={{ color: "#555" }}>Screenshot this and send it — this is the real error.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// The public document is separate from React's empty root. Keep it until a
// successful app commit, so no-JS visitors and boot failures retain readable content.
function PublicDocumentHandoff({children}) {
  React.useLayoutEffect(() => { document.getElementById("public-document")?.remove(); }, []);
  return children;
}

const container = document.getElementById("root");
const application = (
  <React.StrictMode>
    <ErrorBoundary>
      <PublicDocumentHandoff><App /></PublicDocumentHandoff>
    </ErrorBoundary>
  </React.StrictMode>
);

const hydrate = shouldHydrateHomepage({hasServerMarkup: container.dataset.homeHydration === 'v1',
  pathname: window.location.pathname, search: window.location.search, hash: window.location.hash});
// Reuse the first visible hero and navigation nodes instead of replacing them
// with a second client render after the main JavaScript finishes loading.
export const applicationRoot = hydrate ? ReactDOM.hydrateRoot(container, application) : ReactDOM.createRoot(container);
if (!hydrate) applicationRoot.render(application);

