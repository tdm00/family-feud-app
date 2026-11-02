import { Route, Routes } from "react-router-dom";
import { AdminPage } from "./pages/Admin.js";
import { DisplayPage } from "./pages/Display.js";
import { HostPage } from "./pages/Host.js";
import { JoinPage } from "./pages/Join.js";
import { PlayPage } from "./pages/Play.js";
import { appVersion } from "./version.js";

export function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<JoinPage />} />
        <Route path="/play" element={<PlayPage />} />
        <Route path="/host" element={<HostPage />} />
        <Route path="/display" element={<DisplayPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
      <footer className="pointer-events-none fixed inset-x-0 bottom-0 pb-1 text-center text-[11px] leading-none text-white/40">
        {appVersion}
      </footer>
    </>
  );
}
