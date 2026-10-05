import "@fontsource/oswald/600.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/600.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { unlockAudio } from "./sounds.js";
import "./index.css";

window.addEventListener("pointerdown", () => unlockAudio(), { once: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
