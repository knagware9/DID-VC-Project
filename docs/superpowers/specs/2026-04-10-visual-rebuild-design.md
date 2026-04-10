# Visual Rebuild — Government Portal Style
**Date:** 2026-04-10  
**Status:** Approved

## Context

The existing DID-VC platform uses a top-navbar + tab-based layout with a purple gradient theme. The target mockup (https://did-portal-frontend-mockup-1.replit.app/) calls for a professional blue/gray government-portal aesthetic with a fixed left sidebar replacing the current top-nav tabs. All screens — public and authenticated — need to be restyled. No backend or logic changes.

---

## Approach: CSS + AppShell Refactor (Option A)

Keep all existing page logic intact. Add one new `AppShell` layout component that wraps authenticated pages (sidebar + top header). Update CSS design tokens globally. Public pages get a minimal centered layout.

---

## Color System

| Token | Value | Usage |
|-------|-------|-------|
| `--color-sidebar-bg` | `#1e2a3a` | Sidebar background |
| `--color-sidebar-text` | `#94a3b8` | Inactive sidebar labels |
| `--color-sidebar-active-bg` | `#2563eb` | Active nav item background |
| `--color-sidebar-active-text` | `#ffffff` | Active nav item text |
| `--color-sidebar-hover` | `#263548` | Hover state |
| `--color-primary` | `#1a56db` | Primary buttons, links |
| `--color-primary-hover` | `#1e40af` | Button hover |
| `--color-page-bg` | `#f1f5f9` | Authenticated page background |
| `--color-card-bg` | `#ffffff` | Card/panel background |
| `--color-border` | `#e2e8f0` | Card borders, dividers |
| `--color-text-primary` | `#0f172a` | Headings, body text |
| `--color-text-secondary` | `#64748b` | Labels, subtitles |
| `--color-success` | `#059669` | Approved badges |
| `--color-warning` | `#d97706` | Pending badges |
| `--color-danger` | `#dc2626` | Rejected badges, errors |
| `--color-header-bg` | `#ffffff` | Top header bar |

Replace all existing purple/gradient tokens in `index.css` and `App.css`.

---

## Layout Shell (Authenticated Pages)

```
┌──────────────────────────────────────────────┐
│  Top header: Logo + Page title + User + Logout│  60px, #ffffff, border-bottom
├──────────────┬───────────────────────────────┤
│              │                               │
│   Sidebar    │   Page Content Area           │
│   240px      │   bg: #f1f5f9, pad: 24px      │
│   #1e2a3a    │                               │
│              │                               │
└──────────────┴───────────────────────────────┘
```

### New component: `src/frontend/components/AppShell.tsx`
- Fixed sidebar (240px, full height, `#1e2a3a`)
- Logo at top of sidebar: "DID VC Platform" in white
- Nav items below logo: icon + label, active state highlighted blue
- Top header bar (60px): current page title (left) + user name/role badge + Logout button (right)
- Content area: scrollable, `#f1f5f9` background, `24px` padding
- Responsive: sidebar collapses to icon-only below 1024px (future-friendly, not required now)

### Sidebar nav items per role

**Corporate:**
- Overview (home icon)
- Credentials (badge icon)
- Employees (users icon)
- Requests (file-text icon)
- Proof Requests (shield icon)
- Wallet (wallet icon)
- Team (team icon, admin only)
- VP Queue (clock icon, checker only)

**Government Agency (Authority):**
- Overview (home icon)
- Applications (file-text icon)
- Checker Queue (check-circle icon, checker/admin only)

**Verifier:**
- Overview (home icon)
- Verification Requests (list icon)
- New Request (plus-circle icon)
- Received (inbox icon)

**Portal Manager:**
- Overview (home icon)
- Authorities (shield icon)
- DID Registry (key icon)
- Organizations (building icon)

### Icons
Use inline SVG or Unicode characters — no icon library dependency. Simple stroked icons sufficient.

---

## Tab → Sidebar Migration

Current dashboards use `tab` state + conditional rendering. With the sidebar, replace `tab` state with a URL hash or keep the same state variable — the sidebar items set `tab` on click instead of HTML tabs. This requires **no structural change** to page logic, only the tab-strip UI is removed and the sidebar drives the same state.

---

## Public Pages

No sidebar. Replace current top `<Navbar>` on public pages with:
- Minimal centered header: `#ffffff` bar, logo left, Login/Register links right
- Page body: `#f1f5f9` background (matches authenticated area for consistency)
- Cards centered, max-width 480px for auth forms, 900px for landing

**Affected pages:** `/` (Dashboard), `/login`, `/register`, `/signup` (OrganizationApplyPage)

---

## Files to Create / Modify

| File | Action | What changes |
|------|--------|--------------|
| `src/frontend/components/AppShell.tsx` | **Create** | New sidebar + header layout wrapper |
| `src/frontend/index.css` | **Modify** | Replace color tokens, card/button styles |
| `src/frontend/App.css` | **Modify** | Remove gradient background, update navbar |
| `src/frontend/App.tsx` | **Modify** | Wrap authenticated routes in `AppShell`; replace `Navbar` on public routes with slim header |
| `src/frontend/pages/CorporateDashboard.tsx` | **Modify** | Remove internal tab strip UI; sidebar drives `tab` state via props |
| `src/frontend/pages/AuthorityDashboard.tsx` | **Modify** | Remove internal tab strip |
| `src/frontend/pages/VerifierDashboard.tsx` | **Modify** | Remove internal tab strip |
| `src/frontend/pages/PortalManagerDashboard.tsx` | **Modify** | Remove internal tab strip |
| `src/frontend/pages/Dashboard.tsx` | **Modify** | Public landing page restyled (no sidebar) |
| `src/frontend/pages/LoginPage.tsx` | **Modify** | Restyled with new color tokens |
| `src/frontend/pages/RegisterPage.tsx` | **Modify** | Restyled |
| `src/frontend/pages/OrganizationApplyPage.tsx` | **Modify** | Restyled |
| `src/frontend/pages/VPComposerPage.tsx` | **Modify** | Restyled (uses AppShell) |

---

## Card & Button Style Updates

**Cards:** White background, `1px solid #e2e8f0`, `8px` border-radius, `16-24px` padding, subtle `box-shadow: 0 1px 3px rgba(0,0,0,0.06)`.

**Primary button:** `#1a56db` background, white text, `6px` border-radius, hover `#1e40af`. No gradient.

**Secondary button:** White background, `1px solid #e2e8f0`, `#374151` text.

**Badges/status pills:** Color-coded, no border, `4px` border-radius, small font.

---

## Verification

1. Start frontend: `npm run dev:frontend`
2. Visit `/` → landing page has slim white header, `#f1f5f9` background, blue buttons
3. Visit `/login` → centered white card, no gradient background, blue "Sign In" button
4. Log in as verifier → lands on `/verifier/dashboard` with left sidebar showing nav items
5. Click each sidebar item → correct tab renders in content area
6. Active sidebar item is highlighted blue
7. Log in as government_agency → sidebar shows authority nav items
8. Log in as portal_manager → sidebar shows portal nav items
9. `/signup` (org apply) → restyled with new colors, no sidebar
