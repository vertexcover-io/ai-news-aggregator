import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RunPage } from "./pages/RunPage";
import { ArchivePage } from "./pages/ArchivePage";

function App(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/run" replace />} />
      <Route path="/run" element={<RunPage />} />
      <Route path="/archive/:runId" element={<ArchivePage />} />
    </Routes>
  );
}

export default App;
