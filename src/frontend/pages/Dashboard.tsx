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
