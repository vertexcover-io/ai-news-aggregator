import type { ReactElement } from "react";
import { Outlet } from "react-router-dom";

function Nav(): ReactElement {
  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-[860px] items-center justify-between px-6 py-4">
        <span className="text-sm font-semibold text-neutral-900">AI Newsletter</span>
        <a href="https://vertexcover.io" target="_blank" rel="noopener noreferrer" className="text-sm text-neutral-600 hover:text-neutral-900">About</a>
      </div>
    </nav>
  );
}

function Footer(): ReactElement {
  return (
    <footer className="mt-16 py-8 text-center font-mono text-xs text-neutral-500">
      Made by Vertexcover
    </footer>
  );
}

export function PublicLayout(): ReactElement {
  return (
    <div className="min-h-screen bg-white">
      <Nav />
      <Outlet />
      <Footer />
    </div>
  );
}
