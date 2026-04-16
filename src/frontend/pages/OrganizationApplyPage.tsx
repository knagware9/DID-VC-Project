import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const COMPANY_CATEGORIES = ['Private Limited', 'Public Limited', 'LLP', 'OPC', 'Section 8'];

type DocumentBlock = {
  vc_type: string;
  type: string;
  label: string;
  required: boolean;
  reference_field: string;
  reference_placeholder: string;
};

const DOCUMENT_BLOCKS: DocumentBlock[] = [
  { vc_type: 'MCARegistration', type: 'MCARegistration', label: 'MCA Registration Certificate', required: true, reference_field: 'ref_MCARegistration', reference_placeholder: 'e.g. U72900MH2020PTC123456' },
  { vc_type: 'GSTINCredential', type: 'GSTINCredential', label: 'GSTIN Certificate', required: false, reference_field: 'ref_GSTINCredential', reference_placeholder: 'e.g. 27AABCU9603R1Z5' },
  { vc_type: 'IECCredential', type: 'IECCredential', label: 'IEC (Import Export Code)', required: false, reference_field: 'ref_IECCredential', reference_placeholder: 'e.g. ABCDE1234F' },
  { vc_type: 'PANCredential', type: 'PANCredential', label: 'PAN Card', required: false, reference_field: 'ref_PANCredential', reference_placeholder: 'e.g. AABCU9603R' },
];

export default function OrganizationApplyPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [applicationId, setApplicationId] = useState('');

  // Signatory
  const [signatory, setSignatory] = useState({ name: '', email: '' });
  const [signatoryTempPassword, setSignatoryTempPassword] = useState('');

  // DID Issuer
  const [issuers, setIssuers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [selectedIssuerId, setSelectedIssuerId] = useState('');
  const [issuersLoading, setIssuersLoading] = useState(false);

  // Step 1 — Company Info
  const [form, setForm] = useState({
    org_name: '', cin: '', pan_number: '', gstn: '', state: '', pincode: '',
    date_of_incorporation: '', company_status: 'Active', company_category: 'Private Limited',
    // legacy director fields (kept for schema compatibility)
    director_full_name: '', aadhaar_number: '000000000000', dob: '1990-01-01', gender: 'Male',
    director_name: '', din: '00000000', designation: 'Director',
  });

  // Step 2 — Key People
  const [people, setPeople] = useState({
    super_admin_name: '', super_admin_email: '',
    requester_name: '', requester_email: '',
  });

  // Step 3 — Documents
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const setFormField = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));
  const setPeopleField = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setPeople(p => ({ ...p, [k]: e.target.value }));
  const setRef = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setRefs(r => ({ ...r, [k]: e.target.value }));
  const setFile = (vcType: string, f: File | null) =>
    setFiles(prev => ({ ...prev, [vcType]: f }));

  function validateStep1() {
    const missing = ['org_name', 'cin', 'pan_number', 'state', 'pincode', 'date_of_incorporation']
      .filter(k => !(form as any)[k]);
    if (missing.length) { setError(`Please fill in: ${missing.join(', ')}`); return false; }
    setError(''); return true;
  }

  async function loadIssuers() {
    setIssuersLoading(true);
    try {
      const res = await fetch('/api/public/did-issuers');
      const data = await res.json();
      setIssuers(data.issuers || []);
    } catch {
      setError('Failed to load DID Issuers');
    } finally {
      setIssuersLoading(false);
    }
  }

  function validateStep2() {
    const { super_admin_name, super_admin_email, requester_name, requester_email } = people;
    if (!super_admin_name || !super_admin_email || !requester_name || !requester_email) {
      setError('All key people fields are required'); return false;
    }
    if (!signatory.name || !signatory.email) {
      setError('Authorized Signatory name and email are required'); return false;
    }
    setError(''); return true;
  }

  function validateStep3() {
    if (!selectedIssuerId) { setError('Please select a DID Issuer'); return false; }
    setError(''); return true;
  }

  function validateStep4() {
    const mcaRef = refs['ref_MCARegistration'];
    if (!mcaRef) { setError('MCA Registration reference number is required'); return false; }
    setError(''); return true;
  }

  async function handleSubmit() {
    setLoading(true);
    setError('');
    try {
      const fd = new FormData();

      // Company info
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.set('company_name', form.org_name); // org_name is the company name
      fd.set('email', people.super_admin_email);
      fd.set('ie_code', '');

      // Key people
      Object.entries(people).forEach(([k, v]) => fd.append(k, v));

      // Documents JSON (without file_path — server attaches from uploaded files)
      const documents = DOCUMENT_BLOCKS
        .filter(b => refs[b.reference_field] || files[b.vc_type])
        .map(b => ({
          type: b.type,
          vc_type: b.vc_type,
          reference_number: refs[b.reference_field] || '',
          required: b.required,
        }));
      // Signatory + issuer
      fd.append('signatory_name', signatory.name);
      fd.append('signatory_email', signatory.email);
      fd.append('assigned_issuer_id', selectedIssuerId);

      fd.append('documents', JSON.stringify(documents));

      // File uploads
      DOCUMENT_BLOCKS.forEach(b => {
        const f = files[b.vc_type];
        if (f) fd.append(`doc_${b.vc_type}`, f);
      });

      const res = await fetch('/api/organizations/apply', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');
      setApplicationId(data.applicationId);
      setSignatoryTempPassword(data.signatory_temp_password || '');
      setStep(6); // success screen
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ── Success screen ──
  if (step === 6) {
    return (
      <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div style={{ background: 'white', borderRadius: 12, padding: '2.5rem', maxWidth: 480, width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
          <h2 style={{ color: '#16a34a', marginBottom: '0.5rem', fontWeight: 800 }}>Application Submitted!</h2>
          <p style={{ color: '#64748b', marginBottom: '1rem', lineHeight: 1.6 }}>
            Your application ID is:
          </p>
          <code style={{ background: '#f1f5f9', padding: '0.5rem 1rem', borderRadius: 6, fontSize: '0.8rem', color: '#1e293b', display: 'block', marginBottom: '1.5rem', wordBreak: 'break-all' }}>
            {applicationId}
          </code>
          {signatoryTempPassword && (
            <>
              <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '0.5rem', marginTop: '0.5rem' }}>
                Authorized Signatory login credentials:
              </p>
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '0.75rem', marginBottom: '1.5rem', fontSize: '0.8rem', color: '#92400e', textAlign: 'left' }}>
                <div>📧 {signatory.email}</div>
                <div style={{ marginTop: '0.35rem' }}>🔑 Temp password: <strong>{signatoryTempPassword}</strong></div>
                <div style={{ marginTop: '0.5rem', fontSize: '0.7rem' }}>Share these credentials with your Authorized Signatory. They can change the password after first login.</div>
              </div>
            </>
          )}
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '2rem' }}>
            We'll email you when your corporate DID is ready. Authorized Signatory reviews → DID Issuer Maker verifies → DID Issuer Checker issues your DID + credentials.
          </p>
          <button style={{ background: '#2563eb', color: 'white', border: 'none', padding: '0.75rem 2rem', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}
            onClick={() => navigate('/login')}>
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ color: '#0f172a', fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.25rem' }}>Corporate Registration</h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>Step {step} of 5</p>
        </div>

        {/* Progress bar */}
        <div style={{ display: 'flex', gap: 6, marginBottom: '2rem' }}>
          {[1, 2, 3, 4, 5].map(s => (
            <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: s <= step ? '#2563eb' : '#e2e8f0', transition: 'background 0.3s' }} />
          ))}
        </div>

        <div style={{ background: 'white', borderRadius: 12, padding: '2rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.5rem', fontSize: '0.875rem' }}>
              {error}
            </div>
          )}

          {/* ── Step 1: Company Information ── */}
          {step === 1 && (
            <>
              <h2 style={{ fontWeight: 700, color: '#0f172a', marginBottom: '1.5rem', fontSize: '1.1rem' }}>Company Information</h2>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem', color: '#374151' }}>Company Name *</label>
                <input style={inputStyle} value={form.org_name} onChange={setFormField('org_name')} placeholder="e.g. FSV Labs Pvt Ltd" />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.35rem', color: '#374151' }}>CIN (Corporate Identification No.) *</label>
                <input style={inputStyle} value={form.cin} onChange={setFormField('cin')} placeholder="e.g. U72900MH2020PTC123456" maxLength={21} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={labelStyle}>PAN Number *</label>
                  <input style={inputStyle} value={form.pan_number} onChange={setFormField('pan_number')} placeholder="AABCU9603R" maxLength={10} />
                </div>
                <div>
                  <label style={labelStyle}>GSTIN (optional)</label>
                  <input style={inputStyle} value={form.gstn} onChange={setFormField('gstn')} placeholder="27AABCU9603R1Z5" maxLength={15} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={labelStyle}>State *</label>
                  <input style={inputStyle} value={form.state} onChange={setFormField('state')} placeholder="Maharashtra" />
                </div>
                <div>
                  <label style={labelStyle}>Pincode *</label>
                  <input style={inputStyle} value={form.pincode} onChange={setFormField('pincode')} placeholder="400001" maxLength={6} />
                </div>
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={labelStyle}>Date of Incorporation *</label>
                <input style={inputStyle} type="date" value={form.date_of_incorporation} onChange={setFormField('date_of_incorporation')} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <label style={labelStyle}>Company Status</label>
                  <select style={inputStyle} value={form.company_status} onChange={setFormField('company_status')}>
                    <option>Active</option><option>Inactive</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Category</label>
                  <select style={inputStyle} value={form.company_category} onChange={setFormField('company_category')}>
                    {COMPANY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <button style={nextBtnStyle} onClick={() => { if (validateStep1()) setStep(2); }}>
                Next →
              </button>
            </>
          )}

          {/* ── Step 2: Key People ── */}
          {step === 2 && (
            <>
              <h2 style={{ fontWeight: 700, color: '#0f172a', marginBottom: '1.5rem', fontSize: '1.1rem' }}>Key People</h2>

              {/* Super Admin */}
              <div style={{ background: '#eff6ff', borderRadius: 8, padding: '1rem', marginBottom: '1rem', border: '1px solid #bfdbfe' }}>
                <div style={{ fontWeight: 700, color: '#2563eb', marginBottom: '0.75rem', fontSize: '0.9rem' }}>👤 Super Admin</div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={labelStyle}>Full Name *</label>
                  <input style={{ ...inputStyle, borderColor: '#bfdbfe' }} value={people.super_admin_name} onChange={setPeopleField('super_admin_name')} placeholder="Kamlesh Nagware" />
                </div>
                <div>
                  <label style={labelStyle}>Email *</label>
                  <input style={{ ...inputStyle, borderColor: '#bfdbfe' }} type="email" value={people.super_admin_email} onChange={setPeopleField('super_admin_email')} placeholder="admin@company.com" />
                </div>
              </div>

              {/* Requester */}
              <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem', border: '1px solid #bbf7d0' }}>
                <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: '0.75rem', fontSize: '0.9rem' }}>📋 Corporate Requester</div>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={labelStyle}>Full Name *</label>
                  <input style={{ ...inputStyle, borderColor: '#bbf7d0' }} value={people.requester_name} onChange={setPeopleField('requester_name')} placeholder="Priya Sharma" />
                </div>
                <div>
                  <label style={labelStyle}>Email *</label>
                  <input style={{ ...inputStyle, borderColor: '#bbf7d0' }} type="email" value={people.requester_email} onChange={setPeopleField('requester_email')} placeholder="requester@company.com" />
                </div>
              </div>

              {/* Authorized Signatory */}
              <div style={{ background: '#fff7ed', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem', border: '1px solid #fed7aa' }}>
                <div style={{ fontWeight: 700, color: '#d97706', marginBottom: '0.75rem', fontSize: '0.9rem' }}>✍️ Authorized Signatory</div>
                <p style={{ fontSize: '0.75rem', color: '#92400e', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                  This person will receive a login to review and approve this application before it is sent to the DID Issuer.
                </p>
                <div style={{ marginBottom: '0.75rem' }}>
                  <label style={labelStyle}>Full Name *</label>
                  <input style={{ ...inputStyle, borderColor: '#fed7aa' }}
                    value={signatory.name}
                    onChange={e => setSignatory(s => ({ ...s, name: e.target.value }))}
                    placeholder="Authorized Signatory name" />
                </div>
                <div>
                  <label style={labelStyle}>Email *</label>
                  <input style={{ ...inputStyle, borderColor: '#fed7aa' }} type="email"
                    value={signatory.email}
                    onChange={e => setSignatory(s => ({ ...s, email: e.target.value }))}
                    placeholder="signatory@company.com" />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button style={backBtnStyle} onClick={() => setStep(1)}>← Back</button>
                <button style={{ ...nextBtnStyle, flex: 2 }} onClick={() => { if (validateStep2()) { loadIssuers(); setStep(3); } }}>Next →</button>
              </div>
            </>
          )}

          {/* ── Step 3: Select DID Issuer ── */}
          {step === 3 && (
            <>
              <h2 style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.5rem', fontSize: '1.1rem' }}>Select DID Issuer</h2>
              <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '1.5rem' }}>
                Which DID Issuer will issue your corporate DID and Verifiable Credentials?
              </p>

              {issuersLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>Loading issuers…</div>
              ) : issuers.length === 0 ? (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '1rem', color: '#dc2626', fontSize: '0.875rem' }}>
                  No DID Issuers available. Please contact support.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  {issuers.map(iss => (
                    <label key={iss.id} style={{
                      display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem',
                      borderRadius: 8, cursor: 'pointer',
                      border: `2px solid ${selectedIssuerId === iss.id ? '#2563eb' : '#e2e8f0'}`,
                      background: selectedIssuerId === iss.id ? '#eff6ff' : 'white',
                    }}>
                      <input type="radio" name="issuer" value={iss.id}
                        checked={selectedIssuerId === iss.id}
                        onChange={() => setSelectedIssuerId(iss.id)}
                        style={{ accentColor: '#2563eb' }} />
                      <div>
                        <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem' }}>{iss.name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{iss.email}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button style={backBtnStyle} onClick={() => setStep(2)}>← Back</button>
                <button style={{ ...nextBtnStyle, flex: 2 }} onClick={() => { if (validateStep3()) setStep(4); }}>
                  Next →
                </button>
              </div>
            </>
          )}

          {/* ── Step 4: Supporting Documents ── */}
          {step === 4 && (
            <>
              <h2 style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.5rem', fontSize: '1.1rem' }}>Supporting Documents</h2>
              <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '1.5rem' }}>Each uploaded document generates one Verifiable Credential on approval.</p>

              {DOCUMENT_BLOCKS.map(block => (
                <div key={block.vc_type} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '1rem', marginBottom: '0.75rem', background: '#f8fafc' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>{block.label}</span>
                    <span style={{
                      background: block.required ? '#dcfce7' : '#f1f5f9',
                      color: block.required ? '#16a34a' : '#64748b',
                      fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px', borderRadius: 8,
                    }}>
                      {block.required ? 'REQUIRED' : 'OPTIONAL'}
                    </span>
                  </div>
                  <div style={{ marginBottom: '0.5rem' }}>
                    <label style={labelStyle}>Reference Number{block.required ? ' *' : ''}</label>
                    <input style={{ ...inputStyle, background: 'white' }}
                      value={refs[block.reference_field] || ''}
                      onChange={setRef(block.reference_field)}
                      placeholder={block.reference_placeholder} />
                  </div>
                  {/* File upload drop zone */}
                  <div
                    style={{
                      border: `2px dashed ${files[block.vc_type] ? '#16a34a' : '#cbd5e1'}`,
                      borderRadius: 6, padding: '0.75rem', textAlign: 'center', cursor: 'pointer', background: 'white',
                    }}
                    onClick={() => fileInputRefs.current[block.vc_type]?.click()}
                  >
                    {files[block.vc_type] ? (
                      <>
                        <div style={{ fontSize: '1.25rem' }}>📄</div>
                        <div style={{ fontSize: '0.75rem', color: '#1e293b', marginTop: '0.25rem' }}>{files[block.vc_type]!.name}</div>
                        <div style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: 700 }}>✓ Uploaded</div>
                      </>
                    ) : (
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        + Upload {block.label} (PDF / JPG / PNG, max 5 MB)
                      </div>
                    )}
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      style={{ display: 'none' }}
                      ref={el => { fileInputRefs.current[block.vc_type] = el; }}
                      onChange={e => setFile(block.vc_type, e.target.files?.[0] || null)}
                    />
                  </div>
                </div>
              ))}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button style={backBtnStyle} onClick={() => setStep(3)}>← Back</button>
                <button style={{ ...nextBtnStyle, flex: 2 }} onClick={() => { if (validateStep4()) setStep(5); }}>Next →</button>
              </div>
            </>
          )}

          {/* ── Step 5: Review & Submit ── */}
          {step === 5 && (
            <>
              <h2 style={{ fontWeight: 700, color: '#0f172a', marginBottom: '1.5rem', fontSize: '1.1rem' }}>Review & Submit</h2>

              {/* Company */}
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem' }}>{form.org_name}</div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>CIN: {form.cin} · PAN: {form.pan_number}</div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{form.state} {form.pincode} · Inc: {form.date_of_incorporation}</div>
              </div>

              {/* Key People */}
              <div style={{ background: '#eff6ff', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ fontWeight: 700, color: '#2563eb', marginBottom: '0.5rem', fontSize: '0.85rem' }}>Key People</div>
                <div style={{ fontSize: '0.8rem', color: '#374151' }}>Admin: {people.super_admin_name} ({people.super_admin_email})</div>
                <div style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.25rem' }}>Requester: {people.requester_name} ({people.requester_email})</div>
                <div style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.25rem' }}>Signatory: {signatory.name} ({signatory.email})</div>
                <div style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.25rem' }}>DID Issuer: {issuers.find(i => i.id === selectedIssuerId)?.name || selectedIssuerId}</div>
              </div>

              {/* Documents */}
              <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ fontWeight: 700, color: '#16a34a', marginBottom: '0.5rem', fontSize: '0.85rem' }}>Documents → VCs on Approval</div>
                {DOCUMENT_BLOCKS.filter(b => refs[b.reference_field] || files[b.vc_type]).map(b => (
                  <div key={b.vc_type} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#374151', marginBottom: '0.25rem' }}>
                    <span style={{ color: '#16a34a' }}>✓</span>
                    <span>{b.vc_type} VC ← {files[b.vc_type]?.name || `(ref: ${refs[b.reference_field]})`}</span>
                  </div>
                ))}
              </div>

              {/* Info box */}
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1.5rem', fontSize: '0.8rem', color: '#92400e' }}>
                ⏱ After submission: Authorized Signatory reviews → DID Issuer Maker verifies → DID Issuer Checker issues your corporate DID + credentials
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button style={backBtnStyle} onClick={() => setStep(4)}>← Back</button>
                <button
                  style={{ ...nextBtnStyle, flex: 2, background: loading ? '#94a3b8' : '#16a34a' }}
                  disabled={loading}
                  onClick={handleSubmit}
                >
                  {loading ? 'Submitting…' : 'Submit Application ✓'}
                </button>
              </div>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', color: '#64748b', fontSize: '0.875rem' }}>
          Already approved? <a href="/login" style={{ color: '#2563eb' }}>Login here</a>
        </p>
      </div>
    </div>
  );
}

// ── Shared styles ──
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #e2e8f0',
  borderRadius: 6, fontSize: '0.875rem', color: '#1e293b', background: 'white',
  boxSizing: 'border-box' as const, outline: 'none',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.3rem', color: '#374151',
};
const nextBtnStyle: React.CSSProperties = {
  flex: 1, padding: '0.75rem', background: '#2563eb', color: 'white', border: 'none',
  borderRadius: 8, fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer',
};
const backBtnStyle: React.CSSProperties = {
  flex: 1, padding: '0.75rem', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0',
  borderRadius: 8, fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
};
