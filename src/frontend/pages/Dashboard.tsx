import React, { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const roleConfig: Record<string, { path: string; label: string }> = {
  corporate: { path: '/corporate/dashboard', label: 'Corporate Dashboard' },
  government_agency: { path: '/authority/dashboard', label: 'Authority Dashboard' },
  verifier: { path: '/verifier/dashboard', label: 'Verifier Portal' },
  portal_manager: { path: '/portal/dashboard', label: 'Portal Manager' },
};

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate(roleConfig[user.role]?.path ?? '/', { replace: true });
  }, [user, navigate]);

  if (user) return null;

  return (
    <div style={{ maxWidth: 900, margin: '3rem auto', padding: '0 1.5rem' }}>
      <div className="card" style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h1>DID VC Platform</h1>
        <p style={{ color: '#666', marginBottom: '1.5rem' }}>
          Blockchain-agnostic identity management — issue, store, and verify credentials on Polygon.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
        <div className="card">
          <h3>Corporate</h3>
          <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Manage employees (Sub-DIDs), request DGFT credentials, issue employment VCs, compose presentations.
          </p>
          <Link to="/register" className="btn btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Get Started
          </Link>
        </div>

        <div className="card">
          <h3>Government Agency (DGFT)</h3>
          <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Review corporate VC requests, sign and issue credentials, manage the approval queue.
          </p>
          <Link to="/register" className="btn btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Get Started
          </Link>
        </div>

        <div className="card">
          <h3>Verifier</h3>
          <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Generate proof requests, review submitted presentations, and approve or reject verifications.
          </p>
          <Link to="/register" className="btn btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Get Started
          </Link>
        </div>
      </div>

      {!user && (
        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <Link to="/login" className="btn btn-primary" style={{ textDecoration: 'none', marginRight: '1rem' }}>Login</Link>
          <Link to="/register" className="btn btn-secondary" style={{ textDecoration: 'none' }}>Register</Link>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
