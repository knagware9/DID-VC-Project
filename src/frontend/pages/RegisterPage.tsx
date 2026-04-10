import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, UserRole } from '../contexts/AuthContext';

export default function RegisterPage() {
  const { register } = useAuth();
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'verifier' as UserRole, authority_type: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const roles = [
    { value: 'verifier', label: 'Verifier / Relying Party', desc: 'Verify presentations from corporates' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await register(form.email, form.password, form.role, form.name, form.authority_type || undefined); }
    catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ maxWidth: 480, margin: '40px auto', padding: '0 1rem' }}>
      <div className="card">
        <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Create Account</h2>
        <div style={{ background: '#f0f4ff', border: '1px solid #667eea', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Corporate / importer-exporter? <a href="/signup" style={{ color: '#667eea', fontWeight: 600 }}>Apply for organization registration →</a>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Full Name / Organization</label>
            <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Acme Corp / DGFT India" />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input className="form-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input className="form-input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={8} />
          </div>
          <div className="form-group">
            <label>Role</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
              {roles.map(r => (
                <label key={r.value} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.75rem', border: `2px solid ${form.role === r.value ? '#667eea' : '#e2e8f0'}`, borderRadius: '8px', cursor: 'pointer', background: form.role === r.value ? '#f0f4ff' : 'white' }}>
                  <input type="radio" name="role" value={r.value} checked={form.role === r.value} onChange={() => setForm(f => ({ ...f, role: r.value as UserRole }))} style={{ marginTop: '2px' }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>{r.label}</div>
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>{r.desc}</div>
                  </div>
                </label>
              ))}
          </div>
          </div>
          {form.role === 'government_agency' && (
            <div className="form-group" style={{ marginTop: '0.75rem' }}>
              <label>Authority Type *</label>
              <select
                className="form-input"
                value={form.authority_type}
                onChange={e => setForm(f => ({ ...f, authority_type: e.target.value }))}
                required
              >
                <option value="">Select your authority</option>
                <option value="mca">MCA — Ministry of Corporate Affairs</option>
                <option value="dgft">DGFT — Directorate General of Foreign Trade</option>
                <option value="gstn_trust_anchor">GSTN — GST Trust Anchor</option>
                <option value="pan_trust_anchor">Income Tax — PAN Trust Anchor</option>
              </select>
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: '1rem' }}>
            {loading ? 'Creating account...' : 'Register'}
          </button>
          <p style={{ textAlign: 'center', marginTop: '1rem' }}>
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
