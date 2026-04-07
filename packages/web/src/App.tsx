import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { PasswordGate } from "./auth/PasswordGate";
import { RunPage } from "./pages/RunPage";

function App(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/run" replace />} />
      <Route
        path="/run"
        element={
          <PasswordGate>
            <RunPage />
          </PasswordGate>
        }
      />
    </Routes>
  );
}

export default App;
