import {
  useState,
  type ReactElement,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { useAuth } from "./useAuth";

interface PasswordGateProps {
  children: ReactNode;
}

export function PasswordGate({ children }: PasswordGateProps): ReactElement {
  const { isAuthenticated, login } = useAuth();
  const [value, setValue] = useState("");

  if (isAuthenticated) {
    return <>{children}</>;
  }

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (value.trim().length === 0) return;
    login(value.trim());
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-8 rounded shadow max-w-sm w-full space-y-4"
      >
        <h1 className="text-xl font-semibold">Enter password</h1>
        <input
          type="password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          className="w-full border border-gray-300 rounded px-3 py-2"
          placeholder="Password"
          autoFocus
        />
        <button
          type="submit"
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
