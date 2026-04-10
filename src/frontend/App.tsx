import React, { useState } from 'react';
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
import AuthorityLoginPage from './pages/AuthorityLoginPage';
import AuthorityDashboard from './pages/AuthorityDashboard';
import PortalManagerDashboard from './pages/PortalManagerDashboard';
import ProtectedRoute from './components/ProtectedRoute';
import './App.css';

const ROLE_LABELS: Record<string, string> = {
  corporate: 'Corporate',
  government_agency: 'Authority',
  verifier: 'Verifier',
  portal_manager: 'Portal Manager',
};

function Navbar() {
  const { user, logout } = useAuth();

  return (
    <nav className="navbar">
      <div className="nav-container">
        <Link to="/" className="nav-logo">DID VC Platform</Link>
        <div className="nav-links">
          {user ? (
            <>
              {user.role === 'corporate' && <>
                <Link to="/corporate/dashboard" className="nav-link">Dashboard</Link>
                <Link to="/corporate/compose-vp" className="nav-link">Compose VP</Link>
              </>}
              {user.role === 'government_agency' && <Link to="/authority/dashboard" className="nav-link">Issuer Panel</Link>}
              {user.role === 'verifier' && <Link to="/verifier/dashboard" className="nav-link">Verifier Portal</Link>}
              {user.role === 'portal_manager' && <Link to="/portal/dashboard" className="nav-link">Portal Admin</Link>}
            </>
          ) : (
            <>
              <Link to="/" className="nav-link">Home</Link>
              <Link to="/login" className="nav-link">Login</Link>
              <Link to="/register" className="nav-link">Register</Link>
            </>
          )}
        </div>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ color: '#667eea', fontWeight: 500, fontSize: '0.9rem' }}>
              {user.name || user.email}
              <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', background: '#e2e8f0', padding: '2px 8px', borderRadius: '12px', color: '#555' }}>
                {ROLE_LABELS[user.role] || user.role}
                {user.sub_role ? ` · ${user.sub_role.replace(/_/g, ' ')}` : ''}
              </span>
            </span>
            <button className="btn btn-secondary btn-sm" onClick={logout}>Logout</button>
          </div>
        )}
      </div>
    </nav>
  );
}

function ProtectedRouteWrapper({ role, children }: { role: string; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ textAlign: 'center', padding: '3rem' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/corporate/dashboard" element={<ProtectedRouteWrapper role="corporate"><CorporateDashboard /></ProtectedRouteWrapper>} />
      <Route path="/corporate/compose-vp" element={<ProtectedRouteWrapper role="corporate"><VPComposerPage /></ProtectedRouteWrapper>} />
      <Route path="/issuer/dashboard" element={<ProtectedRouteWrapper role="government_agency"><GovtIssuerDashboard /></ProtectedRouteWrapper>} />
      <Route path="/verifier/dashboard" element={<ProtectedRouteWrapper role="verifier"><VerifierDashboard /></ProtectedRouteWrapper>} />
      <Route path="/signup" element={<OrganizationApplyPage />} />
      <Route path="/authority-login" element={<Navigate to="/login" replace />} />
      <Route path="/authority/dashboard" element={<ProtectedRouteWrapper role="government_agency"><AuthorityDashboard /></ProtectedRouteWrapper>} />
      <Route path="/portal/dashboard" element={<ProtectedRouteWrapper role="portal_manager"><PortalManagerDashboard /></ProtectedRouteWrapper>} />
      <Route path="/share/:token" element={<ShareViewPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="app">
          <Navbar />
          <main className="main-content"><AppRoutes /></main>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
