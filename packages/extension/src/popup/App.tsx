import { useEffect, useState } from "react";
import { getToken } from "../lib/storage";
import LoginView from "./LoginView";
import AddView from "./AddView";

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getToken()
      .then((t) => {
        setToken(t);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>;

  if (!token) {
    return (
      <LoginView
        onLogin={(t) => {
          setToken(t);
        }}
      />
    );
  }

  return (
    <AddView
      token={token}
      onLogout={() => {
        setToken(null);
      }}
    />
  );
}
