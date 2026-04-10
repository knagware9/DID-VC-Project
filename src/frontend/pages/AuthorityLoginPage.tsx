import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AuthorityLoginPage() {
  const navigate = useNavigate();
  const { login, verifyMFA } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await login(email, password);
      if (result.mfaRequired && result.tempToken) {
        setTempToken(result.tempToken);
        setMfaCode(result.mfaCode || ''); // demo: pre-fill from response
        setStep('mfa');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await verifyMFA(tempToken, mfaCode);
      // verifyMFA handles token storage and redirectByRole internally
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 400, padding: '2.5rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ background: '#667eea', color: '#fff', display: 'inline-block', padding: '0.4rem 1rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            DGFT
          </div>
          <h2 style={{ margin: 0, color: '#333' }}>Token Layer</h2>
          <p style={{ color: '#666', margin: '0.25rem 0 0' }}>Authority Login Portal</p>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

        {step === 'credentials' ? (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>Email Address</label>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
                <span style={{ background: '#667eea', color: '#fff', padding: '0.5rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>DGFT</span>
                <input style={{ border: 'none', outline: 'none', padding: '0.5rem', flex: 1 }} type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="authority@dgft.gov.in" />
              </div>
            </div>
            <div className="form-group">
              <label>Password</label>
              <input className="form-control" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleMfa}>
            <p style={{ color: '#666', marginBottom: '1rem' }}>Enter the 6-digit MFA code sent to your registered device.</p>
            <div className="form-group">
              <label>MFA Code</label>
              <input className="form-control" value={mfaCode} onChange={e => setMfaCode(e.target.value)} required maxLength={6} placeholder="6-digit code" />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
