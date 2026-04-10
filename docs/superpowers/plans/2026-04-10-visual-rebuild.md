# Visual Rebuild — Government Portal Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the purple-gradient top-navbar layout with a professional blue/gray government-portal style using a fixed left sidebar and role-aware navigation across all pages.

**Architecture:** A new `AppShell` component wraps every authenticated page, providing a dark-navy sidebar (240px) and a white top header. The sidebar drives dashboard tab state via a shared `AppShellContext`. Public pages (login, register, apply, landing) get a minimal slim header with no sidebar. Global CSS tokens are replaced from purple to blue/gray throughout.

**Tech Stack:** React 18, TypeScript, CSS custom properties (no new dependencies)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/frontend/index.css` | Modify | Body background, global font, design tokens |
| `src/frontend/App.css` | Modify | All shared component styles (cards, buttons, alerts, badges, forms) |
| `src/frontend/components/AppShell.tsx` | **Create** | Sidebar + top header layout; AppShellContext provider |
| `src/frontend/App.tsx` | Modify | Wrap authenticated routes in AppShell; replace Navbar with SlimHeader for public routes |
| `src/frontend/pages/Dashboard.tsx` | Modify | Public landing page restyled — no sidebar |
| `src/frontend/pages/LoginPage.tsx` | Modify | Restyled with new color tokens |
| `src/frontend/pages/RegisterPage.tsx` | Modify | Restyled |
| `src/frontend/pages/OrganizationApplyPage.tsx` | Modify | Restyled |
| `src/frontend/pages/CorporateDashboard.tsx` | Modify | Remove tab strip; replace internal `tab` state with `useAppShell()` context |
| `src/frontend/pages/AuthorityDashboard.tsx` | Modify | Remove tab strip; replace internal `view` state with `useAppShell()` context |
| `src/frontend/pages/VerifierDashboard.tsx` | Modify | Remove tab strip; replace internal `tab` state with `useAppShell()` context |
| `src/frontend/pages/PortalManagerDashboard.tsx` | Modify | Remove tab strip; replace internal `tab` state with `useAppShell()` context |
| `src/frontend/pages/VPComposerPage.tsx` | Modify | Restyle step indicator and cards with new tokens |

---

## Task 1: Replace Global CSS Tokens

**Files:**
- Modify: `src/frontend/index.css`
- Modify: `src/frontend/App.css`

- [ ] **Step 1: Replace `index.css` entirely**

```css
/* src/frontend/index.css */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background: #f1f5f9;
  min-height: 100vh;
  color: #0f172a;
}

code {
  font-family: source-code-pro, Menlo, Monaco, Consolas, 'Courier New', monospace;
}

#root {
  min-height: 100vh;
}
```

- [ ] **Step 2: Replace `App.css` entirely**

```css
/* src/frontend/App.css */

/* ── Layout ─────────────────────────────────────── */
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* ── Slim public header (unauthenticated pages) ─── */
.public-header {
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  padding: 0 2rem;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.public-header-logo {
  font-size: 1.2rem;
  font-weight: 700;
  color: #1a56db;
  text-decoration: none;
}

.public-header-links {
  display: flex;
  gap: 1.5rem;
}

.public-header-links a {
  color: #374151;
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 500;
  transition: color 0.2s;
}

.public-header-links a:hover {
  color: #1a56db;
}

/* Keep .navbar/.nav-* for backward compat but point to slim style */
.navbar {
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  padding: 0 2rem;
  height: 60px;
  display: flex;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 1000;
}

.nav-container {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.nav-logo {
  font-size: 1.2rem;
  font-weight: 700;
  color: #1a56db;
  text-decoration: none;
}

.nav-links {
  display: flex;
  gap: 1.5rem;
}

.nav-link {
  color: #374151;
  text-decoration: none;
  font-weight: 500;
  font-size: 0.9rem;
  transition: color 0.2s;
}

.nav-link:hover {
  color: #1a56db;
}

/* ── AppShell layout ────────────────────────────── */
.app-shell {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 240px;
  min-height: 100vh;
  background: #1e2a3a;
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 100;
}

.sidebar-logo {
  padding: 20px 20px 16px;
  font-size: 1rem;
  font-weight: 700;
  color: #ffffff;
  border-bottom: 1px solid #263548;
  letter-spacing: 0.01em;
}

.sidebar-logo span {
  color: #60a5fa;
}

.sidebar-nav {
  flex: 1;
  padding: 12px 0;
}

.sidebar-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  color: #94a3b8;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  border-radius: 0;
}

.sidebar-nav-item:hover {
  background: #263548;
  color: #e2e8f0;
}

.sidebar-nav-item.active {
  background: #1a56db;
  color: #ffffff;
}

.sidebar-nav-item .nav-icon {
  font-size: 1rem;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.sidebar-section-label {
  padding: 16px 20px 6px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #475569;
}

/* ── Shell content area ─────────────────────────── */
.shell-content {
  margin-left: 240px;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.shell-header {
  height: 60px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  position: sticky;
  top: 0;
  z-index: 50;
}

.shell-header-title {
  font-size: 1rem;
  font-weight: 600;
  color: #0f172a;
}

.shell-header-user {
  display: flex;
  align-items: center;
  gap: 12px;
}

.shell-header-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
}

.shell-main {
  flex: 1;
  background: #f1f5f9;
  padding: 24px;
}

/* ── Main content (non-shell pages) ─────────────── */
.main-content {
  flex: 1;
  padding: 2rem;
}

/* ── Cards ──────────────────────────────────────── */
.card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  margin-bottom: 1.5rem;
}

.card-title {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 1rem;
  color: #0f172a;
}

/* ── Forms ──────────────────────────────────────── */
.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  font-weight: 600;
  margin-bottom: 0.4rem;
  font-size: 0.875rem;
  color: #374151;
}

.form-input,
.form-textarea {
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1.5px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.875rem;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.2s;
  background: #ffffff;
  color: #0f172a;
}

.form-input:focus,
.form-textarea:focus {
  border-color: #1a56db;
}

.form-textarea {
  min-height: 100px;
  font-family: inherit;
  resize: vertical;
}

/* ── Buttons ────────────────────────────────────── */
.btn {
  padding: 0.55rem 1.25rem;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, box-shadow 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: #1a56db;
  color: #ffffff;
}

.btn-primary:hover:not(:disabled) {
  background: #1e40af;
}

.btn-secondary {
  background: #ffffff;
  color: #374151;
  border: 1px solid #e2e8f0;
}

.btn-secondary:hover:not(:disabled) {
  background: #f8fafc;
}

.btn-success {
  background: #059669;
  color: #ffffff;
}

.btn-success:hover:not(:disabled) {
  background: #047857;
}

.btn-danger {
  background: #dc2626;
  color: #ffffff;
}

.btn-danger:hover:not(:disabled) {
  background: #b91c1c;
}

.btn-sm {
  padding: 0.35rem 0.75rem;
  font-size: 0.8rem;
}

/* ── Alerts ─────────────────────────────────────── */
.alert {
  padding: 0.75rem 1rem;
  border-radius: 6px;
  margin-bottom: 1rem;
  font-size: 0.875rem;
}

.alert-success {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #bbf7d0;
}

.alert-error {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.alert-info {
  background: #dbeafe;
  color: #1e40af;
  border: 1px solid #bfdbfe;
}

/* ── Badges ─────────────────────────────────────── */
.badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
}

.badge-success {
  background: #dcfce7;
  color: #166534;
}

.badge-error {
  background: #fee2e2;
  color: #991b1b;
}

.badge-info {
  background: #dbeafe;
  color: #1e40af;
}

.badge-warning {
  background: #fef3c7;
  color: #92400e;
}

/* ── Misc ────────────────────────────────────────── */
.loading {
  text-align: center;
  padding: 2rem;
  color: #64748b;
}

.page-container {
  max-width: 1100px;
  margin: 0 auto;
}

.credential-list { display: grid; gap: 1rem; }

.credential-item {
  background: #f8fafc;
  border: 1.5px solid #e2e8f0;
  border-radius: 6px;
  padding: 1rem;
  transition: border-color 0.2s;
}

.credential-item:hover {
  border-color: #1a56db;
}

.credential-id {
  font-family: monospace;
  font-size: 0.875rem;
  color: #1a56db;
  word-break: break-all;
}
```

- [ ] **Step 3: Verify fonts and base colors render**

Start frontend: `npm run dev:frontend`  
Visit `http://localhost:3000/` — body should be light gray (`#f1f5f9`), no purple gradient.

- [ ] **Step 4: Commit**

```bash
cd /Users/kamleshnagware/did-vc-project
git add src/frontend/index.css src/frontend/App.css
git commit -m "style: replace purple gradient tokens with blue/gray government palette"
```

---

## Task 2: Create AppShell Component

**Files:**
- Create: `src/frontend/components/AppShell.tsx`

- [ ] **Step 1: Create `AppShell.tsx`**

```tsx
// src/frontend/components/AppShell.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface AppShellContextType {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const AppShellContext = createContext<AppShellContextType>({
  activeTab: '',
  setActiveTab: () => {},
});

export function useAppShell() {
  return useContext(AppShellContext);
}

interface NavItem {
  tab: string;
  label: string;
  icon: string;
  subRoles?: string[]; // if set, only show for these sub_roles
}

const NAV_ITEMS: Record<string, NavItem[]> = {
  corporate: [
    { tab: 'credentials',    label: 'My Credentials',  icon: '🏷' },
    { tab: 'employees',      label: 'Employees',        icon: '👥' },
    { tab: 'requests',       label: 'Pending Requests', icon: '📄' },
    { tab: 'issue',          label: 'Issue & Request',  icon: '📝' },
    { tab: 'proof-requests', label: 'Proof Requests',   icon: '🛡' },
    { tab: 'corp-wallet',    label: 'Wallet',           icon: '💼' },
    { tab: 'team',           label: 'Team',             icon: '🤝', subRoles: ['super_admin', 'admin'] },
    { tab: 'vp-queue',       label: 'VP Queue',         icon: '⏳', subRoles: ['checker'] },
  ],
  government_agency: [
    { tab: 'dashboard',      label: 'Overview',         icon: '🏠' },
    { tab: 'pending',        label: 'Applications',     icon: '📄' },
    { tab: 'checker-queue',  label: 'Checker Queue',    icon: '✅', subRoles: ['checker', 'vc_issuer_admin'] },
  ],
  verifier: [
    { tab: 'requests',  label: 'Verification Requests', icon: '📋' },
    { tab: 'new',       label: 'New Request',           icon: '➕' },
    { tab: 'received',  label: 'Received',              icon: '📥' },
  ],
  portal_manager: [
    { tab: 'overview',       label: 'Overview',         icon: '🏠' },
    { tab: 'authorities',    label: 'Authorities',      icon: '🛡' },
    { tab: 'dids',           label: 'DID Registry',     icon: '🔑' },
    { tab: 'organizations',  label: 'Organizations',    icon: '🏢' },
  ],
};

const ROLE_LABELS: Record<string, string> = {
  corporate: 'Corporate',
  government_agency: 'Authority',
  verifier: 'Verifier',
  portal_manager: 'Portal Manager',
};

interface AppShellProps {
  children: React.ReactNode;
  pageTitle?: string;
}

export default function AppShell({ children, pageTitle }: AppShellProps) {
  const { user, logout } = useAuth();
  const role = user?.role ?? '';
  const subRole = user?.sub_role ?? '';

  const allNavItems = NAV_ITEMS[role] ?? [];
  const navItems = allNavItems.filter(item =>
    !item.subRoles || item.subRoles.includes(subRole)
  );

  const defaultTab = navItems[0]?.tab ?? '';
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Reset to default tab when role changes (e.g. after re-login)
  useEffect(() => {
    if (navItems.length > 0 && !navItems.find(n => n.tab === activeTab)) {
      setActiveTab(navItems[0].tab);
    }
  }, [role, subRole]);

  const currentNavItem = navItems.find(n => n.tab === activeTab);
  const title = pageTitle ?? currentNavItem?.label ?? ROLE_LABELS[role] ?? 'Dashboard';

  return (
    <AppShellContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="app-shell">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            DID <span>VC</span> Platform
          </div>
          <nav className="sidebar-nav">
            {navItems.map(item => (
              <button
                key={item.tab}
                className={`sidebar-nav-item${activeTab === item.tab ? ' active' : ''}`}
                onClick={() => setActiveTab(item.tab)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="shell-content">
          <header className="shell-header">
            <span className="shell-header-title">{title}</span>
            <div className="shell-header-user">
              <span className="shell-header-name">
                {user?.name || user?.email}
                <span style={{ marginLeft: 8, fontSize: '0.75rem', background: '#f1f5f9', padding: '2px 8px', borderRadius: 12, color: '#64748b' }}>
                  {ROLE_LABELS[role] ?? role}
                  {subRole ? ` · ${subRole.replace(/_/g, ' ')}` : ''}
                </span>
              </span>
              <button className="btn btn-secondary btn-sm" onClick={logout}>Logout</button>
            </div>
          </header>
          <main className="shell-main">
            {children}
          </main>
        </div>
      </div>
    </AppShellContext.Provider>
  );
}
```

- [ ] **Step 2: Verify file compiles (no imports yet)**

```bash
cd /Users/kamleshnagware/did-vc-project
npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors for the new file (may show errors in other files — those get fixed in later tasks).

- [ ] **Step 3: Commit**

```bash
git add src/frontend/components/AppShell.tsx
git commit -m "feat: add AppShell component with sidebar navigation and AppShellContext"
```

---

## Task 3: Update App.tsx — Wire AppShell + Slim Public Header

**Files:**
- Modify: `src/frontend/App.tsx`

- [ ] **Step 1: Read current App.tsx to orient** (already read — key changes below)

- [ ] **Step 2: Replace `App.tsx` entirely**

```tsx
// src/frontend/App.tsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import CorporateDashboard from './pages/CorporateDashboard';
import GovtIssuerDashboard from './pages/GovtIssuerDashboard';
import VerifierDashboard from './pages/VerifierDashboard';
import VPComposerPage from './pages/VPComposerPage';
import Dashboard from './pages/Dashboard';
import ShareViewPage from './pages/ShareViewPage';
import OrganizationApplyPage from './pages/OrganizationApplyPage';
import AuthorityDashboard from './pages/AuthorityDashboard';
import PortalManagerDashboard from './pages/PortalManagerDashboard';
import ProtectedRoute from './components/ProtectedRoute';
import AppShell from './components/AppShell';
import './App.css';

function SlimHeader() {
  const { user } = useAuth();
  return (
    <header className="public-header">
      <Link to="/" className="public-header-logo">DID VC Platform</Link>
      <div className="public-header-links">
        {user ? (
          <Link to="/">Home</Link>
        ) : (
          <>
            <Link to="/login">Login</Link>
            <Link to="/register">Register</Link>
          </>
        )}
      </div>
    </header>
  );
}

function ProtectedRouteWrapper({ role, children }: { role: string; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes — slim header, no sidebar */}
      <Route path="/" element={<><SlimHeader /><div className="main-content"><Dashboard /></div></>} />
      <Route path="/login" element={<><SlimHeader /><div className="main-content"><LoginPage /></div></>} />
      <Route path="/register" element={<><SlimHeader /><div className="main-content"><RegisterPage /></div></>} />
      <Route path="/signup" element={<><SlimHeader /><div className="main-content"><OrganizationApplyPage /></div></>} />
      <Route path="/share/:token" element={<><SlimHeader /><div className="main-content"><ShareViewPage /></div></>} />

      {/* Authenticated routes — AppShell sidebar */}
      <Route path="/corporate/dashboard" element={
        <ProtectedRouteWrapper role="corporate">
          <AppShell><CorporateDashboard /></AppShell>
        </ProtectedRouteWrapper>
      } />
      <Route path="/corporate/compose-vp" element={
        <ProtectedRouteWrapper role="corporate">
          <AppShell pageTitle="Compose VP"><VPComposerPage /></AppShell>
        </ProtectedRouteWrapper>
      } />
      <Route path="/issuer/dashboard" element={
        <ProtectedRouteWrapper role="government_agency">
          <AppShell><GovtIssuerDashboard /></AppShell>
        </ProtectedRouteWrapper>
      } />
      <Route path="/authority/dashboard" element={
        <ProtectedRouteWrapper role="government_agency">
          <AppShell><AuthorityDashboard /></AppShell>
        </ProtectedRouteWrapper>
      } />
      <Route path="/verifier/dashboard" element={
        <ProtectedRouteWrapper role="verifier">
          <AppShell><VerifierDashboard /></AppShell>
        </ProtectedRouteWrapper>
      } />
      <Route path="/portal/dashboard" element={
        <ProtectedRouteWrapper role="portal_manager">
          <AppShell><PortalManagerDashboard /></AppShell>
        </ProtectedRouteWrapper>
      } />
      <Route path="/authority-login" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="app">
          <AppRoutes />
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
```

- [ ] **Step 3: Verify in browser**

Visit `http://localhost:3000/` — should show slim white header (no purple navbar), light gray body.  
Visit `http://localhost:3000/login` — slim header, white login card on gray background.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/App.tsx
git commit -m "feat: replace top navbar with slim public header; wrap authenticated routes in AppShell"
```

---

## Task 4: Restyle Public Pages

**Files:**
- Modify: `src/frontend/pages/Dashboard.tsx`
- Modify: `src/frontend/pages/LoginPage.tsx`
- Modify: `src/frontend/pages/RegisterPage.tsx`
- Modify: `src/frontend/pages/OrganizationApplyPage.tsx`

- [ ] **Step 1: Update `Dashboard.tsx`**

The Dashboard already has `useEffect` auto-redirect when user is logged in (from previous fix). Only the unauthenticated view needs restyling — remove the logged-in alert block, keep the role-card grid.

Replace the return JSX:

```tsx
// src/frontend/pages/Dashboard.tsx
import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const roleDefaultPath: Record<string, string> = {
  corporate: '/corporate/dashboard',
  government_agency: '/authority/dashboard',
  verifier: '/verifier/dashboard',
  portal_manager: '/portal/dashboard',
};

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate(roleDefaultPath[user.role] ?? '/', { replace: true });
  }, [user, navigate]);

  if (user) return null;

  return (
    <div style={{ maxWidth: 960, margin: '3rem auto', padding: '0 1.5rem' }}>
      <div className="card" style={{ textAlign: 'center', marginBottom: '2rem', padding: '2.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.75rem' }}>
          DID VC Platform
        </h1>
        <p style={{ color: '#64748b', fontSize: '1rem' }}>
          Blockchain-agnostic identity management — issue, store, and verify credentials on Polygon.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem' }}>
        {[
          { title: 'Corporate', desc: 'Manage employees (Sub-DIDs), request DGFT credentials, issue employment VCs, compose presentations.' },
          { title: 'Government Agency (DGFT)', desc: 'Review corporate VC requests, sign and issue credentials, manage the approval queue.' },
          { title: 'Verifier', desc: 'Generate proof requests, review submitted presentations, and approve or reject verifications.' },
        ].map(card => (
          <div key={card.title} className="card" style={{ marginBottom: 0 }}>
            <h3 style={{ fontWeight: 700, marginBottom: '0.5rem', color: '#0f172a' }}>{card.title}</h3>
            <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1.25rem' }}>{card.desc}</p>
            <Link to="/register" className="btn btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
              Get Started
            </Link>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: '2rem' }}>
        <Link to="/login" className="btn btn-primary" style={{ textDecoration: 'none', marginRight: '1rem' }}>Login</Link>
        <Link to="/register" className="btn btn-secondary" style={{ textDecoration: 'none' }}>Register</Link>
      </div>
    </div>
  );
};

export default Dashboard;
```

- [ ] **Step 2: Update `LoginPage.tsx`** — restyle the card only, keep all logic identical

In `LoginPage.tsx`, the only change needed is removing any purple inline styles. The card styles come from `App.css` (already updated), and the component uses `.card`, `.form-group`, `.form-input`, `.btn-primary`, `.btn-secondary`, `.alert-error` — all now blue/gray from Task 1. No JSX changes needed unless purple is hardcoded in inline styles.

Check for inline `color: '#667eea'` or similar and replace:

```tsx
// In LoginPage.tsx — no structural change needed.
// The CSS classes updated in Task 1 handle all styling.
// Only change: if any inline style uses purple, replace with blue.
// Verify the file has no inline color references:
```

Run in terminal:
```bash
grep -n "667eea\|764ba2\|gradient" /Users/kamleshnagware/did-vc-project/src/frontend/pages/LoginPage.tsx
```

If output is empty — no changes needed. If hits found, replace each `#667eea` with `#1a56db`.

- [ ] **Step 3: Update `RegisterPage.tsx`** — same check

```bash
grep -n "667eea\|764ba2\|gradient" /Users/kamleshnagware/did-vc-project/src/frontend/pages/RegisterPage.tsx
```

Replace any found `#667eea` → `#1a56db`.

- [ ] **Step 4: Update `OrganizationApplyPage.tsx`** — check + fix inline styles

```bash
grep -n "667eea\|764ba2\|gradient\|purple" /Users/kamleshnagware/did-vc-project/src/frontend/pages/OrganizationApplyPage.tsx
```

The OrganizationApplyPage has an explicit purple gradient background. Find the inline background style on the outer container and replace with the page background color:

```tsx
// Find this pattern (outer wrapper):
style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', ... }}
// Replace with:
style={{ background: '#f1f5f9', minHeight: '100vh', padding: '2rem' }}
```

Also find any `color: '#667eea'` and replace with `color: '#1a56db'`.
Also find any section border `borderBottom: '2px solid #667eea'` → `borderBottom: '2px solid #1a56db'`.

- [ ] **Step 5: Verify public pages in browser**

- `http://localhost:3000/` — gray background, white cards, blue buttons  
- `http://localhost:3000/login` — centered white card, blue "Sign In" button, no purple  
- `http://localhost:3000/signup` — gray background form, blue section headings, blue submit button  

- [ ] **Step 6: Commit**

```bash
git add src/frontend/pages/Dashboard.tsx src/frontend/pages/LoginPage.tsx src/frontend/pages/RegisterPage.tsx src/frontend/pages/OrganizationApplyPage.tsx
git commit -m "style: restyle public pages with blue/gray government portal theme"
```

---

## Task 5: Migrate CorporateDashboard to AppShell

**Files:**
- Modify: `src/frontend/pages/CorporateDashboard.tsx`

The dashboard currently has:
- `const [tab, setTab] = useState<Tab>('credentials');` (line ~81)
- A tab-strip `<div>` with buttons at the top of the JSX
- `useEffect(() => { loadAll(); }, [tab])`

- [ ] **Step 1: Replace internal tab state with AppShell context**

At the top of `CorporateDashboard` (after existing imports), add:

```tsx
import { useAppShell } from '../components/AppShell';
```

Remove this line:
```tsx
const [tab, setTab] = useState<Tab>('credentials');
```

Add this line in its place:
```tsx
const { activeTab: tab, setActiveTab: setTab } = useAppShell();
```

This single substitution means all existing `tab` and `setTab` references throughout the file continue to work unchanged.

- [ ] **Step 2: Remove the tab strip UI**

Find and delete the tab-strip `<div>` block. It looks like this (search for the pattern):

```tsx
<div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
  <button ... onClick={() => setTab('credentials')}>My Credentials</button>
  <button ... onClick={() => setTab('employees')}>Employees (Sub-DIDs)</button>
  {/* ... more tab buttons ... */}
</div>
```

Delete this entire block (it's typically 15–25 lines). The sidebar now handles tab switching.

- [ ] **Step 3: Verify in browser**

Log in as a corporate user → `/corporate/dashboard`.  
Should see: dark navy sidebar on left with items (My Credentials, Employees, Pending Requests, Issue & Request, Proof Requests, Wallet), white header, gray content area.  
Clicking sidebar items switches content sections.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/pages/CorporateDashboard.tsx
git commit -m "feat: migrate CorporateDashboard tabs to AppShell sidebar navigation"
```

---

## Task 6: Migrate AuthorityDashboard to AppShell

**Files:**
- Modify: `src/frontend/pages/AuthorityDashboard.tsx`

The dashboard uses `view` (not `tab`) with values `'dashboard' | 'pending' | 'checker-queue'`.

- [ ] **Step 1: Replace internal view state with AppShell context**

Add import:
```tsx
import { useAppShell } from '../components/AppShell';
```

Remove:
```tsx
const [view, setView] = useState<'dashboard' | 'pending' | 'checker-queue'>('dashboard');
```

Add:
```tsx
const { activeTab: view, setActiveTab: setView } = useAppShell();
```

All existing `view` and `setView` references throughout the file continue to work unchanged.

- [ ] **Step 2: Remove the tab strip / view-switcher UI**

Find and delete the navigation buttons block that switches views. It will look like:

```tsx
<div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
  <button onClick={() => setView('dashboard')} ...>Dashboard</button>
  <button onClick={() => setView('pending')} ...>Pending Requests</button>
  {(subRole === 'checker' || subRole === 'vc_issuer_admin') && (
    <button onClick={() => setView('checker-queue')} ...>Checker Queue</button>
  )}
</div>
```

Delete this block. The sidebar handles navigation and already filters by `subRoles`.

- [ ] **Step 3: Remove standalone logout button from AuthorityDashboard**

AuthorityDashboard had its own logout button (line ~181: `navigate('/login')`). The AppShell header now provides logout. Find and remove that button from the dashboard JSX if it exists.

- [ ] **Step 4: Verify in browser**

Log in as government_agency → `/authority/dashboard`.  
Should see sidebar with: Overview, Applications, (Checker Queue if checker/admin role).  
Clicking switches views correctly.

- [ ] **Step 5: Commit**

```bash
git add src/frontend/pages/AuthorityDashboard.tsx
git commit -m "feat: migrate AuthorityDashboard view state to AppShell sidebar navigation"
```

---

## Task 7: Migrate VerifierDashboard to AppShell

**Files:**
- Modify: `src/frontend/pages/VerifierDashboard.tsx`

Uses `tab` with values `'requests' | 'new' | 'received'`.

- [ ] **Step 1: Replace internal tab state with AppShell context**

Add import:
```tsx
import { useAppShell } from '../components/AppShell';
```

Remove:
```tsx
const [tab, setTab] = useState<'requests' | 'new' | 'received'>('requests');
```

Add:
```tsx
const { activeTab: tab, setActiveTab: setTab } = useAppShell();
```

- [ ] **Step 2: Remove the tab strip UI**

Find and delete the tab-strip buttons block (the row of buttons for Verification Requests / New Request for Proof / Received). Delete only the button strip div, not the content panels.

- [ ] **Step 3: Verify in browser**

Log in as verifier → `/verifier/dashboard`.  
Sidebar shows: Verification Requests, New Request, Received.  
Clicking each renders the correct panel.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/pages/VerifierDashboard.tsx
git commit -m "feat: migrate VerifierDashboard tabs to AppShell sidebar navigation"
```

---

## Task 8: Migrate PortalManagerDashboard to AppShell

**Files:**
- Modify: `src/frontend/pages/PortalManagerDashboard.tsx`

Uses `tab` with values `'overview' | 'authorities' | 'dids' | 'organizations'`.

- [ ] **Step 1: Replace internal tab state with AppShell context**

Add import:
```tsx
import { useAppShell } from '../components/AppShell';
```

Remove:
```tsx
const [tab, setTab] = useState<Tab>('overview');
```

(where `type Tab = 'overview' | 'authorities' | 'dids' | 'organizations'`)

Add:
```tsx
const { activeTab: tab, setActiveTab: setTab } = useAppShell();
```

- [ ] **Step 2: Remove the sidebar/tab strip from PortalManagerDashboard**

PortalManagerDashboard likely has its own sidebar or tab list. Find and remove it — the AppShell sidebar replaces it entirely.

Search for the nav/tab block using the known tab values:

```bash
grep -n "authorities\|dids\|organizations\|setTab\|sidebar" /Users/kamleshnagware/did-vc-project/src/frontend/pages/PortalManagerDashboard.tsx | head -30
```

Delete the nav block found.

- [ ] **Step 3: Verify in browser**

Log in as portal_manager → `/portal/dashboard`.  
Sidebar shows: Overview, Authorities, DID Registry, Organizations.  
Clicking each renders the correct panel.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/pages/PortalManagerDashboard.tsx
git commit -m "feat: migrate PortalManagerDashboard tabs to AppShell sidebar navigation"
```

---

## Task 9: Restyle VPComposerPage + Purple Token Sweep

**Files:**
- Modify: `src/frontend/pages/VPComposerPage.tsx`
- Sweep all remaining dashboard files for purple tokens

- [ ] **Step 1: Sweep all dashboard files for lingering purple tokens**

```bash
grep -rn "667eea\|764ba2\|gradient.*purple\|#5a67d8" \
  /Users/kamleshnagware/did-vc-project/src/frontend/pages/ \
  /Users/kamleshnagware/did-vc-project/src/frontend/components/
```

For every hit: replace `#667eea` → `#1a56db`, `#764ba2` → `#1e40af`, gradient purple backgrounds → `#f1f5f9` or `#1a56db` (solid).

- [ ] **Step 2: Fix VPComposerPage step indicator color**

In `VPComposerPage.tsx`, find the step indicator circle background:

```tsx
// Find:
background: step >= s ? '#667eea' : '#e2e8f0'
// Replace with:
background: step >= s ? '#1a56db' : '#e2e8f0'
```

Find step label color:
```tsx
// Find:
color: step >= s ? '#667eea' : '#888'
// Replace with:
color: step >= s ? '#1a56db' : '#94a3b8'
```

- [ ] **Step 3: Verify VP Composer page**

Log in as corporate, navigate to `/corporate/compose-vp`.  
Should see: AppShell sidebar on left, "Compose VP" in header, step indicator in blue (not purple), gray content background.

- [ ] **Step 4: Commit**

```bash
git add src/frontend/pages/VPComposerPage.tsx src/frontend/pages/ src/frontend/components/
git commit -m "style: replace remaining purple tokens with blue/gray across all pages"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Full end-to-end browser check**

With both servers running (`npm run dev:frontend` + backend on port 3002):

| URL | Expected |
|-----|----------|
| `http://localhost:3000/` | Slim white header, gray page bg, blue "Get Started" buttons, no purple |
| `http://localhost:3000/login` | White card, blue "Sign In" button, gray background |
| `http://localhost:3000/signup` | Gray background, blue section borders, blue submit button |
| `/corporate/dashboard` (logged in) | Dark navy sidebar (240px), white header with user name, gray content |
| Sidebar item click | Active item highlighted in blue (#1a56db), content switches |
| `/authority/dashboard` | Sidebar with Overview / Applications / (Checker Queue if applicable) |
| `/verifier/dashboard` | Sidebar with Verification Requests / New Request / Received |
| `/portal/dashboard` | Sidebar with Overview / Authorities / DID Registry / Organizations |
| `/corporate/compose-vp` | AppShell sidebar visible, "Compose VP" in header, blue step indicator |

- [ ] **Step 2: TypeScript check**

```bash
cd /Users/kamleshnagware/did-vc-project
npx tsc --noEmit 2>&1
```

Expected: 0 errors.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete visual rebuild — government portal blue/gray theme with sidebar navigation"
```

---

## Self-Review Against Spec

| Spec requirement | Task |
|---|---|
| Professional blue/gray government portal palette | Task 1 |
| Fixed left sidebar 240px, dark navy `#1e2a3a` | Task 2 |
| Role-aware sidebar nav items | Task 2 (NAV_ITEMS map) |
| Sub-role gated items (team, vp-queue, checker-queue) | Task 2 (subRoles filter) |
| Top header 60px, white, user + logout | Task 2 |
| Content area `#f1f5f9`, 24px padding | Task 1 + 2 |
| Remove old Navbar from authenticated pages | Task 3 |
| Public pages: slim header, no sidebar | Task 3 |
| Public pages restyled | Task 4 |
| CorporateDashboard tab strip removed | Task 5 |
| AuthorityDashboard view strip removed | Task 6 |
| VerifierDashboard tab strip removed | Task 7 |
| PortalManagerDashboard tab strip removed | Task 8 |
| VPComposerPage restyled | Task 9 |
| Purple token sweep | Task 9 |
