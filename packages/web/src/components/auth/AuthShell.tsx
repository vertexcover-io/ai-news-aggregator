import type { ReactElement, ReactNode } from "react";

/**
 * Two-column auth layout (signup, login) from `mocks/signup.html`:
 * a dark `ink` brand aside on the left (~1.05fr) and the form area on the
 * right (1fr). Below `md` the aside is hidden and the form fills the screen
 * (mirrors the mock's `@media (max-width: 880px)`).
 */
export function AuthShell({
  aside,
  children,
}: {
  aside: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="grid min-h-screen grid-cols-1 bg-cream md:grid-cols-[1.05fr_1fr]">
      <aside className="hidden flex-col bg-ink px-14 py-14 text-cream md:flex">
        {aside}
      </aside>
      <main className="grid place-items-center px-6 py-10">
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
    </div>
  );
}
