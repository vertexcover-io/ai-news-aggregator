import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RunPage } from "./pages/RunPage";

function App(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/run" replace />} />
      <Route path="/run" element={<RunPage />} />
    </Routes>
  );
}

export default App;
