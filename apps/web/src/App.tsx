import { Route, Routes } from "react-router-dom";
import { AdminPage } from "./pages/Admin.js";
import { DisplayPage } from "./pages/Display.js";
import { HostPage } from "./pages/Host.js";
import { JoinPage } from "./pages/Join.js";
import { PlayPage } from "./pages/Play.js";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<JoinPage />} />
      <Route path="/play" element={<PlayPage />} />
      <Route path="/host" element={<HostPage />} />
      <Route path="/display" element={<DisplayPage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  );
}
