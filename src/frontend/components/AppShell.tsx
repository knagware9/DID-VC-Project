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
  subRoles?: string[];
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
