import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const roleDefaultPath: Record<string, string> = {
  corporate: '/corporate/dashboard',
  government_agency: '/authority/dashboard',
  verifier: '/verifier/dashboard',
  portal_manager: '/portal/dashboard',
};

type Issuer = { id: string; name: string; email: string };

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [issuers, setIssuers] = useState<Issuer[]>([]);

  useEffect(() => {
    if (user) navigate(roleDefaultPath[user.role] ?? '/', { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    fetch('/api/public/did-issuers')
      .then(r => r.json())
      .then(d => { if (d.success) setIssuers(d.issuers || []); })
      .catch(() => {});
  }, []);

  if (user) return null;

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', minHeight: '100vh' }}>

      {/* ── Top Nav ── */}
      <nav style={{ background: '#0f172a', padding: '0.75rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src="/ibdic-logo.svg" alt="IBDIC" style={{ width: 36, height: 36 }} />
          <span style={{ color: 'white', fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>
            DID·VC Platform
          </span>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Link to="/login" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '0.875rem' }}>Login</Link>
          <Link to="/signup" style={{
            background: '#2563eb', color: 'white', textDecoration: 'none',
            padding: '0.4rem 1rem', borderRadius: 6, fontSize: '0.875rem', fontWeight: 600,
          }}>Register Corporate →</Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ background: 'linear-gradient(135deg, #1e3a5f, #0f172a)', padding: '4rem 2rem' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', gap: '4rem', flexWrap: 'wrap' }}>

          {/* Left — IBDIC branding */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 180, flex: '0 0 auto' }}>
            <img src="/ibdic-logo.svg" alt="IBDIC Logo" style={{ width: 140, height: 140, marginBottom: '1rem' }} />
            <div style={{ color: 'white', fontWeight: 800, fontSize: '1rem', letterSpacing: '0.06em', textAlign: 'center', lineHeight: 1.3 }}>
              IBDIC
            </div>
            <div style={{ color: '#93c5fd', fontSize: '0.72rem', fontWeight: 500, textAlign: 'center', marginTop: '0.3rem', maxWidth: 160 }}>
              Indian Banks' Digital Infrastructure Company
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, background: 'rgba(255,255,255,0.15)', height: 140, flexShrink: 0 }} />

          {/* Right — platform content */}
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: '0.72rem', color: '#60a5fa', fontWeight: 700, letterSpacing: '0.15em', marginBottom: '1rem', textTransform: 'uppercase' }}>
              India's Decentralised Identity Network
            </div>
            <h1 style={{ fontSize: 'clamp(1.6rem, 3.5vw, 2.75rem)', color: 'white', fontWeight: 800, marginBottom: '0.75rem', lineHeight: 1.2 }}>
              Verifiable Credentials for<br />Indian Enterprises
            </h1>
            <p style={{ color: '#94a3b8', fontSize: '1.05rem', marginBottom: '2rem' }}>
              Issue · Verify · Share
            </p>
            <Link to="/signup" style={{
              background: '#2563eb', color: 'white', textDecoration: 'none',
              padding: '0.8rem 2rem', borderRadius: 8, fontSize: '1rem', fontWeight: 700,
              display: 'inline-block',
            }}>
              Register Your Corporate →
            </Link>
          </div>
        </div>
      </section>

      {/* ── DID Issuers Strip ── */}
      <section style={{ background: '#f8fafc', padding: '2rem', borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ textAlign: 'center', fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '1rem' }}>
          Trusted DID Issuers
        </div>
        {issuers.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#cbd5e1', fontSize: '0.85rem' }}>Loading issuers…</p>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            {issuers.map(issuer => (
              <span key={issuer.id} style={{
                background: 'white', border: '1px solid #e2e8f0',
                borderRadius: 8, padding: '0.4rem 1rem',
                fontSize: '0.85rem', fontWeight: 700, color: '#1e293b',
              }}>
                {issuer.name}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ── How It Works ── */}
      <section style={{ background: 'white', padding: '4rem 2rem' }}>
        <h2 style={{ textAlign: 'center', fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', marginBottom: '3rem' }}>
          How It Works
        </h2>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', maxWidth: 700, margin: '0 auto' }}>
          {[
            { icon: '📋', label: 'Register', sub: 'Submit company info & documents' },
            { icon: '✅', label: 'Portal Review', sub: 'Portal Manager activates' },
            { icon: '🔑', label: 'Get DID', sub: 'DID Issuer mints your DID' },
            { icon: '🎖', label: 'Get VCs', sub: 'Credentials issued to wallet' },
          ].map((step, i, arr) => (
            <React.Fragment key={step.label}>
              <div style={{ textAlign: 'center', flex: '1 1 120px', minWidth: 100 }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{step.icon}</div>
                <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.9rem' }}>{step.label}</div>
                <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '0.25rem' }}>{step.sub}</div>
              </div>
              {i < arr.length - 1 && (
                <div style={{ color: '#d1d5db', fontSize: '1.5rem', flexShrink: 0 }}>→</div>
              )}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* ── Role Cards ── */}
      <section style={{ background: '#f8fafc', padding: '4rem 2rem' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
          {[
            { title: 'Corporate', icon: '🏢', desc: 'Register your company, get a decentralised DID, and receive government-issued verifiable credentials.' },
            { title: 'Govt Issuer', icon: '🏛', desc: 'Issue MCA, GSTIN, IEC, and PAN credentials to verified enterprises on your network.' },
            { title: 'Verifier', icon: '🔍', desc: 'Send proof requests to corporate employees and verify credentials instantly.' },
          ].map(card => (
            <div key={card.title} style={{
              background: 'white', borderRadius: 12, padding: '1.75rem',
              border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>{card.icon}</div>
              <h3 style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.5rem' }}>{card.title}</h3>
              <p style={{ color: '#64748b', fontSize: '0.875rem', lineHeight: 1.6 }}>{card.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ background: '#0f172a', padding: '1.5rem 2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem' }}>
        <img src="/ibdic-logo.svg" alt="IBDIC" style={{ width: 24, height: 24, opacity: 0.7 }} />
        <span style={{ color: '#475569', fontSize: '0.8rem' }}>
          IBDIC — Indian Banks' Digital Infrastructure Company &nbsp;|&nbsp; DID·VC Platform
        </span>
      </footer>
    </div>
  );
};

export default Dashboard;
