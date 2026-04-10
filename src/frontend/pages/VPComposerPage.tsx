import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';

type Step = 1 | 2 | 3 | 4;

export default function VPComposerPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>(1);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [selectedCredIds, setSelectedCredIds] = useState<Set<string>>(new Set());
  const [selectedFields, setSelectedFields] = useState<Record<string, Set<string>>>({});
  const [purpose, setPurpose] = useState('');
  const [verifierRequestId, setVerifierRequestId] = useState(() => searchParams.get('requestId') || '');
  const [composedVP, setComposedVP] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    api.getMyCredentials(token).then(d => setCredentials((d.credentials || []).filter((c: any) => !c.revoked))).catch(() => {});
  }, [token]);

  function toggleCred(id: string) {
    setSelectedCredIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        const sf = { ...selectedFields };
        delete sf[id];
        setSelectedFields(sf);
      } else next.add(id);
      return next;
    });
  }

  function toggleField(credId: string, field: string) {
    setSelectedFields(prev => {
      const fields = new Set(prev[credId] || []);
      if (fields.has(field)) fields.delete(field); else fields.add(field);
      return { ...prev, [credId]: fields };
    });
  }

  function getCredFields(cred: any): string[] {
    const subject = cred.vc_json?.credentialSubject || {};
    return Object.keys(subject).filter(k => k !== 'id');
  }

  async function handleCompose() {
    if (!token) return;
    setLoading(true); setError('');
    try {
      const sfMap: Record<string, string[]> = {};
      for (const [credId, fields] of Object.entries(selectedFields)) {
        if (fields.size > 0) sfMap[credId] = Array.from(fields);
      }
      const result = await api.composeVP(token, {
        credentialIds: Array.from(selectedCredIds),
        selectedFields: sfMap,
        verifierRequestId: verifierRequestId || undefined,
        purpose,
      });
      setComposedVP(result.presentation);
      setStep(4);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }

  const selectedCreds = credentials.filter((c: any) => selectedCredIds.has(c.id));

  return (
    <div className="page-container" style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1>Compose Verifiable Presentation</h1>

      {/* Step indicator */}
      <div style={{ display: 'flex', marginBottom: '2rem', position: 'relative' }}>
        {[1, 2, 3, 4].map(s => (
          <div key={s} style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: step >= s ? '#1a56db' : '#e2e8f0', color: step >= s ? 'white' : '#888', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.9rem' }}>{s}</div>
            <div style={{ fontSize: '0.75rem', color: step >= s ? '#1a56db' : '#888', marginTop: '0.25rem' }}>
              {['Select VCs', 'Pick Fields', 'Purpose', 'Review & Sign'][s - 1]}
            </div>
          </div>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Step 1: Select Credentials */}
      {step === 1 && (
        <div>
          <h3>Select Credentials to Include</h3>
          {credentials.length === 0 ? <p style={{ color: '#888' }}>No credentials in wallet. Request some from DGFT first.</p> : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {credentials.map((c: any) => (
                <div key={c.id} onClick={() => toggleCred(c.id)} className="card" style={{ cursor: 'pointer', border: `2px solid ${selectedCredIds.has(c.id) ? '#1a56db' : '#e2e8f0'}`, background: selectedCredIds.has(c.id) ? '#f0f4ff' : 'white' }}>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <input type="checkbox" checked={selectedCredIds.has(c.id)} onChange={() => {}} style={{ width: 18, height: 18 }} />
                    <div>
                      <div style={{ fontWeight: 700 }}>{c.credential_type}</div>
                      <div style={{ fontSize: '0.8rem', color: '#666' }}>Issued: {new Date(c.issued_at).toLocaleDateString()} | Expires: {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : 'N/A'}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={() => setStep(2)} disabled={selectedCredIds.size === 0}>
              Next: Select Fields ({selectedCredIds.size} selected)
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Selective Disclosure */}
      {step === 2 && (
        <div>
          <h3>Select Fields to Disclose</h3>
          <p style={{ color: '#666', fontSize: '0.9rem' }}>Check only the fields you want to share with the verifier. Unchecked fields will not be disclosed.</p>
          {selectedCreds.map((c: any) => {
            const fields = getCredFields(c);
            return (
              <div key={c.id} className="card" style={{ marginBottom: '1rem' }}>
                <h4 style={{ marginBottom: '0.75rem' }}>{c.credential_type}</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {fields.map(f => (
                    <label key={f} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', background: selectedFields[c.id]?.has(f) ? '#f0f4ff' : 'white' }}>
                      <input type="checkbox" checked={selectedFields[c.id]?.has(f) || false} onChange={() => toggleField(c.id, f)} />
                      <span style={{ fontSize: '0.85rem' }}>{f}</span>
                    </label>
                  ))}
                  {fields.length === 0 && <p style={{ color: '#888', fontSize: '0.85rem' }}>No selectable fields found.</p>}
                </div>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button className="btn btn-secondary" onClick={() => setStep(1)}>Back</button>
            <button className="btn btn-primary" onClick={() => setStep(3)}>Next: Set Purpose</button>
          </div>
        </div>
      )}

      {/* Step 3: Purpose & Verifier */}
      {step === 3 && (
        <div style={{ maxWidth: 500 }}>
          <h3>Purpose & Recipient</h3>
          <div className="form-group">
            <label>Presentation Purpose</label>
            <input className="form-input" value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="e.g., Export licence verification for trade partner" />
          </div>
          <div className="form-group">
            <label>Verifier Request ID (optional)</label>
            <input className="form-input" value={verifierRequestId} onChange={e => setVerifierRequestId(e.target.value)} placeholder="Paste request ID from verifier" />
          </div>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <button className="btn btn-secondary" onClick={() => setStep(2)}>Back</button>
            <button className="btn btn-primary" onClick={() => setStep(3.5 as any)}>Next: Data Disclosure Preview</button>
          </div>
        </div>
      )}

      {/* Step 3.5: Disclosure Summary (between 3 and 4) */}
      {(step as any) === 3.5 && (
        <div>
          <h3>Data Disclosure Summary</h3>
          <div className="alert alert-info">Review exactly what data will be shared with the verifier before signing.</div>
          {selectedCreds.map((c: any) => {
            const fields = selectedFields[c.id] ? Array.from(selectedFields[c.id]) : [];
            const subject = c.vc_json?.credentialSubject || {};
            return (
              <div key={c.id} className="card" style={{ marginBottom: '1rem' }}>
                <h4>{c.credential_type}</h4>
                <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
                  {fields.length === 0 ? (
                    <p style={{ color: '#888', fontSize: '0.85rem' }}>All fields will be shared (no selective disclosure)</p>
                  ) : fields.map(f => (
                    <div key={f} style={{ display: 'flex', gap: '1rem', padding: '0.5rem', background: '#f7fafc', borderRadius: '6px', fontSize: '0.85rem' }}>
                      <span style={{ fontWeight: 600, minWidth: 150 }}>{f}</span>
                      <span style={{ color: '#333' }}>{String(subject[f] ?? 'N/A')}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {purpose && <div style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}><strong>Purpose:</strong> {purpose}</div>}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
            <button className="btn btn-secondary" onClick={() => setStep(3)}>Back</button>
            <button className="btn btn-primary" onClick={handleCompose} disabled={loading}>
              {loading ? 'Signing...' : 'Sign & Create VP'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Done */}
      {step === 4 && composedVP && (
        <div>
          <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>✓</div>
            <h2 style={{ color: '#27ae60', marginBottom: '0.5rem' }}>Presentation Submitted</h2>
            <p style={{ color: '#555', marginBottom: '1.5rem' }}>
              Your Verifiable Presentation has been signed and delivered to the verifier.
            </p>
            <div style={{ textAlign: 'left', background: '#f7fafc', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                <strong>Credentials included:</strong>{' '}
                {selectedCreds.map(c => c.credential_type).join(', ') || `${composedVP.verifiableCredential?.length || 0} credential(s)`}
              </div>
              <div style={{ fontSize: '0.9rem' }}>
                <strong>Verifier request:</strong>{' '}
                {verifierRequestId ? <code style={{ fontSize: '0.8rem' }}>{verifierRequestId}</code> : <span style={{ color: '#888' }}>—</span>}
              </div>
            </div>
            <details style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: '#1a56db', marginBottom: '0.5rem' }}>View VP JSON</summary>
              <textarea readOnly value={JSON.stringify(composedVP, null, 2)} rows={10} style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.75rem', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '6px', marginTop: '0.5rem' }} />
              <button className="btn btn-secondary" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }} onClick={() => navigator.clipboard?.writeText(JSON.stringify(composedVP, null, 2))}>Copy VP JSON</button>
            </details>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => { setStep(1); setComposedVP(null); setSelectedCredIds(new Set()); setSelectedFields({}); }}>Create Another</button>
              <button className="btn btn-primary" onClick={() => navigate('/corporate/dashboard')}>← Back to Dashboard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
