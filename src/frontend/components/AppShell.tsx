// src/frontend/components/AppShell.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface BesuStatus {
  demoMode: boolean;
  network: string;
}

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
  subRoles?: string[];
}

const NAV_ITEMS: Record<string, NavItem[]> = {
  corporate: [
    { tab: 'credentials',     label: 'My Credentials',   icon: '🏷' },
    { tab: 'employees',       label: 'Employees',         icon: '👥', subRoles: ['super_admin', 'admin', 'maker', 'checker', 'authorized_signatory', 'requester', 'operator', 'member'] },
    { tab: 'requests',        label: 'My Requests',       icon: '📄', subRoles: ['requester'] },
    { tab: 'request-vc',      label: 'Request VC',        icon: '📝', subRoles: ['requester'] },
    { tab: 'request-did',     label: 'Request DID',       icon: '🔑', subRoles: ['requester', 'super_admin'] },
    { tab: 'corp-queue',      label: 'Review Queue',      icon: '🔍', subRoles: ['maker', 'super_admin'] },
    { tab: 'checker-queue',   label: 'Approval Queue',    icon: '✅', subRoles: ['checker', 'super_admin'] },
    { tab: 'signatory-queue', label: 'Sign & Submit',     icon: '✍️',  subRoles: ['authorized_signatory', 'super_admin'] },
    { tab: 'proof-requests',  label: 'Proof Requests',    icon: '🛡' },
    { tab: 'corp-wallet',     label: 'Wallet',            icon: '💼', subRoles: ['super_admin', 'admin', 'maker', 'checker', 'authorized_signatory', 'requester', 'operator', 'member'] },
    { tab: 'my-wallets',      label: 'My Wallets',        icon: '💼', subRoles: ['employee'] },
    { tab: 'transactions',    label: 'Transactions',      icon: '🔄', subRoles: ['employee'] },
    { tab: 'team',            label: 'Team',              icon: '🤝', subRoles: ['super_admin', 'admin'] },
    { tab: 'vp-queue',        label: 'VP Queue',          icon: '⏳', subRoles: ['checker', 'super_admin'] },
  ],
  government_agency: [
    { tab: 'dashboard',      label: 'Overview',         icon: '🏠' },
    { tab: 'vc-requests',    label: 'VC Requests',      icon: '📄' },
    { tab: 'did-requests',   label: 'DID Requests',     icon: '🔑' },
    { tab: 'checker-queue',  label: 'Checker Queue',    icon: '✅', subRoles: ['checker', 'super_admin'] },
    { tab: 'issued',            label: 'Issued',             icon: '📋' },
    { tab: 'corp-applications', label: 'Corp Applications',  icon: '🏢', subRoles: ['did_issuer_admin'] },
    { tab: 'team',              label: 'Team',               icon: '👥', subRoles: ['super_admin'] },
  ],
  verifier: [
    { tab: 'requests',  label: 'Verification Requests', icon: '📋' },
    { tab: 'new',       label: 'New Request',           icon: '➕', subRoles: ['super_admin', 'maker'] },
    { tab: 'received',  label: 'Received',              icon: '📥' },
    { tab: 'team',      label: 'Team',                  icon: '👥', subRoles: ['super_admin'] },
  ],
  portal_manager: [
    { tab: 'overview',       label: 'Overview',                   icon: '🏠' },
    { tab: 'entities',       label: 'Issuer & Trusted Endorser',  icon: '🌐' },
    { tab: 'applications',   label: 'Corp Applications',          icon: '📋' },
    { tab: 'entity-onboard', label: 'Onboard Entity',             icon: '➕', subRoles: ['super_admin', 'maker'] },
    { tab: 'admin-team',     label: 'Admin Team',                 icon: '👥', subRoles: ['super_admin'] },
    { tab: 'dids',           label: 'DID Registry',               icon: '🔑', subRoles: ['super_admin'] },
    { tab: 'organizations',  label: 'Corporate / Members',        icon: '🏢', subRoles: ['super_admin'] },
    { tab: '__besu_explorer__', label: 'Besu Explorer',           icon: '⛓️', subRoles: ['super_admin'] },
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
  const [besuStatus, setBesuStatus] = useState<BesuStatus | null>(null);

  useEffect(() => {
    if (navItems.length > 0 && !navItems.find(n => n.tab === activeTab)) {
      setActiveTab(navItems[0].tab);
    }
  }, [role, subRole]);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    fetch('/api/besu/status', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setBesuStatus({ demoMode: data.demoMode ?? true, network: data.network ?? 'dev' });
        }
      })
      .catch(() => {});
  }, []);

  const currentNavItem = navItems.find(n => n.tab === activeTab);
  const title = pageTitle ?? currentNavItem?.label ?? ROLE_LABELS[role] ?? 'Dashboard';

  return (
    <AppShellContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-logo">
            DID <span>VC</span> Platform
          </div>
          <nav className="sidebar-nav">
            {navItems.map(item => (
              item.tab === '__besu_explorer__' ? (
                <a
                  key={item.tab}
                  href="/besu/explorer"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sidebar-nav-item"
                  style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                  <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: '#94a3b8' }}>↗</span>
                </a>
              ) : (
                <button
                  key={item.tab}
                  className={`sidebar-nav-item${activeTab === item.tab ? ' active' : ''}`}
                  onClick={() => setActiveTab(item.tab)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              )
            ))}
          </nav>
          <div style={{ marginTop: 'auto', borderTop: '1px solid #e2e8f0' }}>
            <a href="/besu/explorer" target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', textDecoration: 'none', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}>
              <span style={{ fontSize: '0.9rem' }}>⛓️</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: besuStatus?.demoMode ? '#94a3b8' : '#16a34a' }}>
                  {besuStatus?.demoMode ? '⚪ Demo Mode' : '🟢 Besu Live'}
                </div>
                <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Open Explorer ↗</div>
              </div>
            </a>
          </div>
        </aside>

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
