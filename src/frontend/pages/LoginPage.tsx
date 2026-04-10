import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { login, verifyMFA } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const result = await login(email, password);
      if (result.mfaRequired && result.tempToken) {
        setTempToken(result.tempToken);
        setMfaStep(true);
      }
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleMFA = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try { await verifyMFA(tempToken, mfaCode); }
    catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ maxWidth: 420, margin: '60px auto', padding: '0 1rem' }}>
      <div className="card">
        <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          {mfaStep ? 'Enter MFA Code' : 'Sign In'}
        </h2>
        {error && <div className="alert alert-error">{error}</div>}
        {!mfaStep ? (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Email</label>
              <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@company.com" />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <p style={{ textAlign: 'center', marginTop: '1rem' }}>
              Don't have an account? <Link to="/register">Register</Link>
            </p>
          </form>
        ) : (
          <form onSubmit={handleMFA}>
            <div className="form-group">
              <label>6-Digit MFA Code</label>
              <input className="form-input" type="text" value={mfaCode} onChange={e => setMfaCode(e.target.value)} required placeholder="123456" maxLength={6} style={{ letterSpacing: '0.3em', fontSize: '1.2rem', textAlign: 'center' }} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Verifying...' : 'Verify & Login'}
            </button>
            <button type="button" className="btn btn-secondary" style={{ width: '100%', marginTop: '0.5rem' }} onClick={() => { setMfaStep(false); setError(''); }}>
              Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
