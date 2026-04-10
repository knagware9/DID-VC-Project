import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const COMPANY_CATEGORIES = ['Private Limited', 'Public Limited', 'LLP', 'OPC', 'Section 8'];

export default function OrganizationApplyPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    org_name: '', email: '', org_logo_url: '',
    director_full_name: '', aadhaar_number: '', dob: '', gender: '', state: '', pincode: '',
    company_name: '', cin: '', company_status: 'Active', company_category: 'Private Limited',
    date_of_incorporation: '', pan_number: '', gstn: '', ie_code: '',
    director_name: '', din: '', designation: '', signing_authority_level: 'Single Signatory',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/organizations/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');
      setSuccess(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ maxWidth: 480, textAlign: 'center', padding: '2.5rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
          <h2 style={{ color: '#28a745', marginBottom: '0.75rem' }}>Application Submitted!</h2>
          <p style={{ color: '#666', marginBottom: '1.5rem' }}>
            Your organization application has been received. DGFT will review and verify your credentials. You will receive login credentials at your registered email upon approval.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/login')}>Go to Login</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <div className="card" style={{ padding: '2rem' }}>
          <h1 style={{ color: '#667eea', marginBottom: '0.25rem' }}>Organization Registration</h1>
          <p style={{ color: '#666', marginBottom: '2rem' }}>Apply for DGFT-verified digital identity credentials</p>

          {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

          <form onSubmit={handleSubmit}>
            {/* Section 1: Organization Information */}
            <h3 style={{ color: '#333', borderBottom: '2px solid #667eea', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
              Section 1 — Organization Information
            </h3>
            <div className="form-group">
              <label>Organization Name *</label>
              <input className="form-control" value={form.org_name} onChange={set('org_name')} required placeholder="e.g., LNT Exim Private Limited" />
            </div>
            <div className="form-group">
              <label>Email Address *</label>
              <input className="form-control" type="email" value={form.email} onChange={set('email')} required placeholder="admin@yourcompany.com" />
            </div>
            <div className="form-group">
              <label>Organization Logo URL (optional)</label>
              <input className="form-control" value={form.org_logo_url} onChange={set('org_logo_url')} placeholder="https://example.com/logo.png" />
            </div>

            {/* Section 2: Individual Details */}
            <h3 style={{ color: '#333', borderBottom: '2px solid #667eea', paddingBottom: '0.5rem', margin: '1.5rem 0 1rem' }}>
              Section 2 — Individual (Director) Details
            </h3>
            <div className="form-group">
              <label>Full Name *</label>
              <input className="form-control" value={form.director_full_name} onChange={set('director_full_name')} required />
            </div>
            <div className="form-group">
              <label>Aadhaar Number *</label>
              <input className="form-control" value={form.aadhaar_number} onChange={set('aadhaar_number')} required maxLength={12} placeholder="12-digit Aadhaar number" />
            </div>
            <div className="form-group">
              <label>Date of Birth *</label>
              <input className="form-control" type="date" value={form.dob} onChange={set('dob')} required />
            </div>
            <div className="form-group">
              <label>Gender *</label>
              <select className="form-control" value={form.gender} onChange={set('gender')} required>
                <option value="">Select gender</option>
                <option>Male</option>
                <option>Female</option>
                <option>Other</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>State *</label>
                <input className="form-control" value={form.state} onChange={set('state')} required />
              </div>
              <div className="form-group">
                <label>Pincode *</label>
                <input className="form-control" value={form.pincode} onChange={set('pincode')} required maxLength={10} />
              </div>
            </div>

            {/* Section 3: Company Details */}
            <h3 style={{ color: '#333', borderBottom: '2px solid #667eea', paddingBottom: '0.5rem', margin: '1.5rem 0 1rem' }}>
              Section 3 — Company Details
            </h3>
            <div className="form-group">
              <label>Company Name *</label>
              <input className="form-control" value={form.company_name} onChange={set('company_name')} required />
            </div>
            <div className="form-group">
              <label>CIN (Corporate Identification Number) *</label>
              <input className="form-control" value={form.cin} onChange={set('cin')} required placeholder="L51100GJ1993PLC019067" maxLength={21} />
              <small style={{ color: '#888' }}>Format: L51100GJ1993PLC019067</small>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>Company Status *</label>
                <select className="form-control" value={form.company_status} onChange={set('company_status')} required>
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </div>
              <div className="form-group">
                <label>Company Category *</label>
                <select className="form-control" value={form.company_category} onChange={set('company_category')} required>
                  {COMPANY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Date of Incorporation *</label>
              <input className="form-control" type="date" value={form.date_of_incorporation} onChange={set('date_of_incorporation')} required />
            </div>
            <div className="form-group">
              <label>PAN Number *</label>
              <input className="form-control" value={form.pan_number} onChange={set('pan_number')} required placeholder="ABCDE1234F" maxLength={10} />
              <small style={{ color: '#888' }}>Format: ABCDE1234F</small>
            </div>
            <div className="form-group">
              <label>GSTN (GST Identification Number) *</label>
              <input className="form-control" value={form.gstn} onChange={set('gstn')} required placeholder="27ABCDE1234F2Z5" maxLength={15} />
              <small style={{ color: '#888' }}>Format: 27ABCDE1234F2Z5</small>
            </div>
            <div className="form-group">
              <label>IE Code (Import-Export Code) *</label>
              <input className="form-control" value={form.ie_code} onChange={set('ie_code')} required placeholder="ABCDE1234F" maxLength={10} />
              <small style={{ color: '#888' }}>Format: ABCDE1234F — serves as Digital Identity Anchor (DIA)</small>
            </div>
            <div className="form-group">
              <label>Director Name *</label>
              <input className="form-control" value={form.director_name} onChange={set('director_name')} required />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>DIN (Director Identification Number) *</label>
                <input className="form-control" value={form.din} onChange={set('din')} required />
              </div>
              <div className="form-group">
                <label>Designation *</label>
                <input className="form-control" value={form.designation} onChange={set('designation')} required placeholder="e.g., Managing Director" />
              </div>
            </div>

            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: '1rem' }}>
              {loading ? 'Submitting...' : 'Submit Application'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: '1rem', color: '#666', fontSize: '0.875rem' }}>
            Already approved? <a href="/login" style={{ color: '#667eea' }}>Login here</a>
          </p>
        </div>
      </div>
    </div>
  );
}
