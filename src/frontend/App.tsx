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
