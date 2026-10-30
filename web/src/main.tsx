import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installTouchWave } from "./components/app/glitter";
import { listenForInstall } from "./lib/install";

installTouchWave();
// Catch Chrome's install prompt as early as possible, and register the service worker.
listenForInstall();

// Light only by design.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
