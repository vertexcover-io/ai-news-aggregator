import type { ReactElement } from "react";
import { Outlet } from "react-router-dom";

function Nav(): ReactElement {
  return (
    <nav className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-[860px] items-center justify-between px-4 sm:px-6 md:px-8 py-4">
        <span className="text-sm font-semibold text-neutral-900">AI Newsletter</span>
        <a
          href="https://vertexcover.io"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center min-h-[44px] px-2 text-sm text-neutral-600 hover:text-neutral-900"
        >
          About
        </a>
      </div>
    </nav>
  );
}

function Footer(): ReactElement {
  return (
    <footer className="mt-12 md:mt-16 py-6 md:py-8 px-4 sm:px-6 md:px-8 text-center font-mono text-xs text-neutral-500">
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
