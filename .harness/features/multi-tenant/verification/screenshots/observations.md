# Screenshot Observations

## Infrastructure
- API on port 3000, web Vite proxy on port 5173
- PostgreSQL on 5434, Redis on 6379 (both pre-existing, not started by this session)
- DB has 1 tenant: AGENTLOOP (slug=agentloop, status=active)
- Expected page ordering: PublicLayout (Masthead → children → Footer) for public pages; AdminLoginPage standalone for login

---

## homepage-public.png (REQ-040, REQ-041)

### Spec-based checks
| Requirement | Verdict | Evidence |
|-------------|---------|----------|
| REQ-040: Public site uses tenant branding | PARTIAL | Page title shows "AGENTLOOP — The daily read..." but body branding shows "Newsletter" (localhost passthrough fallback). API with `X-Tenant-Slug: agentloop` returns correct "AGENTLOOP" name. |
| REQ-041: Homepage layout unchanged | MET | Masthead, hero, and footer structure visible. No layout breakage. |

### Open visual review
- Page renders masthead area with site branding
- Body shows hero section with headline text
- Footer area visible
- No console errors beyond expected 401 on /api/admin/me (no session)
- No clipping, overlap, or alignment issues detected
- Branding mismatch (title vs body) is a known dev-mode fallback, not a defect in production path

---

## admin-login.png (REQ-005, REQ-007)

### Spec-based checks
| Requirement | Verdict | Evidence |
|-------------|---------|----------|
| REQ-005: Session cookie with user/tenant/role | UNMET | Login form submits to /api/auth/login which returns 404 -- auth routes not mounted |
| REQ-007: 401 without cookie | MET | Navigate to /admin/super/tenants → redirects to login page correctly |

### Open visual review
- Clean centered sign-in card (min(360px, 100%) width)
- "Sign in" heading, Email field, Password field, "Sign in" button
- "Forgot password?" and "Back to archive" links present and styled
- No visual defects: proper spacing, readable labels, appropriate contrast
- Login submit calls /api/auth/login (404) -- feature regression, component renders correctly but cannot authenticate
