import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import QRShareModal from '../components/QRShareModal';
import ShareToDIDModal from '../components/ShareToDIDModal';
import { useAppShell } from '../components/AppShell';


const DIA_CONFIG = [
  { type: 'CompanyRegistrationCredential', label: 'Company Registration', authority: 'MCA',        badge: '#1a73e8', diaLabel: 'DIA1', anchorKey: 'cin' },
  { type: 'IECCredential',                 label: 'IEC Credential',       authority: 'DGFT',       badge: '#667eea', diaLabel: 'DIA2', anchorKey: 'ieCode' },
  { type: 'GSTINCredential',               label: 'GSTIN Credential',     authority: 'GSTN',       badge: '#28a745', diaLabel: 'DIA3', anchorKey: 'gstin' },
  { type: 'PANCredential',                 label: 'PAN Credential',       authority: 'Income Tax', badge: '#e67e22', diaLabel: 'DIA4', anchorKey: 'pan' },
];

function VPDraftForm({ token, walletVCs, onSubmit }: { token: string | null; walletVCs: Record<string, any>; onSubmit: () => void }) {
  const [selectedTypes, setSelectedTypes] = React.useState<string[]>([]);
  const [verifierId, setVerifierId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const toggleType = (type: string) => setSelectedTypes(s => s.includes(type) ? s.filter(t => t !== type) : [...s, type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTypes.length === 0) { setMsg('Select at least one credential'); return; }
    if (!verifierId.trim()) { setMsg('Verifier ID is required'); return; }
    setLoading(true);
    setMsg('');
    try {
      const vcIds = selectedTypes.map(type => walletVCs[type]?.id).filter(Boolean);
      if (vcIds.length === 0) { setMsg('Selected credentials not found in wallet'); setLoading(false); return; }
      const res = await fetch('/api/mc/submit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource_type: 'vp_share', resource_id: crypto.randomUUID(), payload: { vc_ids: vcIds, verifier_id: verifierId, note } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg('✓ VP draft submitted for Checker approval');
      setSelectedTypes([]); setVerifierId(''); setNote('');
      onSubmit();
    } catch (err: any) { setMsg(err.message); }
    finally { setLoading(false); }
  };

  const availableTypes = Object.keys(walletVCs);

  return (
    <form onSubmit={handleSubmit}>
      {msg && <div style={{ marginBottom: '0.75rem', color: msg.startsWith('✓') ? '#28a745' : '#dc3545', fontSize: '0.875rem' }}>{msg}</div>}
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={{ fontWeight: 600, display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Select Credentials *</label>
        {availableTypes.length === 0 ? (
          <div style={{ color: '#888', fontSize: '0.85rem' }}>No credentials in wallet yet.</div>
        ) : availableTypes.map(type => (
          <label key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={selectedTypes.includes(type)} onChange={() => toggleType(type)} />
            <span style={{ fontSize: '0.85rem' }}>{type}</span>
          </label>
        ))}
      </div>
      <div className="form-group">
        <label>Verifier Email / ID *</label>
        <input className="form-input" value={verifierId} onChange={e => setVerifierId(e.target.value)} placeholder="verifier@example.com" />
      </div>
      <div className="form-group">
        <label>Note (optional)</label>
        <input className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g., Trade finance application" />
      </div>
      <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: '0.5rem' }}>
        {loading ? 'Submitting...' : 'Submit VP Draft to Checker'}
      </button>
    </form>
  );
}

export default function CorporateDashboard() {
  const { user, token } = useAuth();
  const { activeTab: tab, setActiveTab: setTab } = useAppShell();
  const [credentials, setCredentials] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [issuedByMe, setIssuedByMe] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Employee form
  const [empForm, setEmpForm] = useState({ employeeId: '', name: '', email: '' });

  // VC request form
  const [vcReqForm, setVcReqForm] = useState({ credentialType: 'DGFTExportLicense', requestData: '{}', issuerUserId: '' });

  // Internal issuance form
  const [issueForm, setIssueForm] = useState({ employeeRegistryId: '', credentialTemplate: 'EmploymentCertificate', credentialData: '{}' });

  const [issuers, setIssuers] = useState<any[]>([]);
  const [qrShareId, setQrShareId] = useState<string | null>(null);
  const [didShareId, setDidShareId] = useState<string | null>(null);
  const [proofRequests, setProofRequests] = useState<any[]>([]);
  const [walletVCs, setWalletVCs] = useState<Record<string, any>>({});
  const [legacyVC, setLegacyVC] = useState<any>(null);
  const [team, setTeam] = useState<any[]>([]);
  const [vpQueue, setVpQueue] = useState<any[]>([]);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', sub_role: 'operator' });
  const [inviteMsg, setInviteMsg] = useState('');
  const subRole = (user as any)?.sub_role;

  useEffect(() => { loadAll(); }, [tab]);

  async function loadAll() {
    if (!token) return;
    setLoading(true);
    try {
      if (tab === 'credentials') {
        const data = await api.getMyCredentials(token);
        setCredentials(data.credentials || []);
      } else if (tab === 'employees') {
        const [emp, issued] = await Promise.all([api.getEmployees(token), api.getIssuedByMe(token)]);
        setEmployees(emp.employees || []);
        setIssuedByMe(issued.credentials || []);
      } else if (tab === 'requests') {
        const data = await api.getMyVCRequests(token);
        setRequests(data.requests || []);
      } else if (tab === 'issue') {
        const data = await api.getIssuers(token);
        setIssuers(data.issuers || []);
      } else if (tab === 'proof-requests') {
        const data = await api.getMyVerificationRequests(token);
        setProofRequests(data.requests || []);
      } else if (tab === 'corp-wallet') {
        const data = await api.getMyCredentials(token);
        const creds = data.credentials || [];
        const vcMap: Record<string, any> = {};
        DIA_CONFIG.forEach(d => {
          const found = creds.find((c: any) => c.credential_type === d.type);
          if (found) vcMap[d.type] = { ...(typeof found.vc_json === 'string' ? JSON.parse(found.vc_json) : found.vc_json), id: found.id };
        });
        setWalletVCs(vcMap);
        // Backward compatibility: legacy OrganizationIdentityCredential
        const legacy = creds.find((c: any) => c.credential_type === 'OrganizationIdentityCredential');
        setLegacyVC(legacy ? (typeof legacy.vc_json === 'string' ? JSON.parse(legacy.vc_json) : legacy.vc_json) : null);
      } else if (tab === 'team') {
        const r = await fetch('/api/corporate/team', { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        setTeam(d.team || []);
      } else if (tab === 'vp-queue') {
        const r = await fetch('/api/mc/queue?resource_type=vp_share', { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        setVpQueue(d.actions || []);
      }
    } catch (e: any) { showMsg('error', e.message); }
    finally { setLoading(false); }
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault(); if (!token) return;
    try {
      await api.createEmployee(token, empForm);
      showMsg('success', 'Employee Sub-DID created successfully');
      setEmpForm({ employeeId: '', name: '', email: '' });
      loadAll();
    } catch (err: any) { showMsg('error', err.message); }
  }

  async function handleVCRequest(e: React.FormEvent) {
    e.preventDefault(); if (!token) return;
    try {
      let parsed = {};
      try { parsed = JSON.parse(vcReqForm.requestData); } catch { showMsg('error', 'Invalid JSON in request data'); return; }
      await api.submitVCRequest(token, { credentialType: vcReqForm.credentialType, requestData: parsed, targetIssuerId: vcReqForm.issuerUserId || undefined });
      showMsg('success', 'VC request submitted to DGFT');
      setVcReqForm(f => ({ ...f, requestData: '{}' }));
      if (tab === 'requests') loadAll();
    } catch (err: any) { showMsg('error', err.message); }
  }

  async function handleIssueToEmployee(e: React.FormEvent) {
    e.preventDefault(); if (!token) return;
    try {
      let parsed = {};
      try { parsed = JSON.parse(issueForm.credentialData); } catch { showMsg('error', 'Invalid JSON'); return; }
      await api.issueToEmployee(token, { ...issueForm, credentialData: parsed });
      showMsg('success', 'Credential issued to employee wallet');
      setIssueForm(f => ({ ...f, credentialData: '{}' }));
      loadAll();
    } catch (err: any) { showMsg('error', err.message); }
  }

  async function handleRevoke(credId: string) {
    if (!token || !confirm('Revoke this credential?')) return;
    try {
      await api.revokeCredential(token, credId);
      showMsg('success', 'Credential revoked');
      loadAll();
    } catch (err: any) { showMsg('error', err.message); }
  }

return (
    <div className="page-container">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1>Corporate Dashboard</h1>
        <p style={{ color: '#666' }}>
          {user?.name} &nbsp;|&nbsp; <code style={{ fontSize: '0.75rem' }}>{user?.did || 'Loading DID...'}</code>
        </p>
      </div>

      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

{loading ? <div style={{ textAlign: 'center', padding: '2rem' }}>Loading...</div> : (
        <>
          {/* Tab: My Credentials */}
          {tab === 'credentials' && (
            <div>
              <h3>Credentials Received</h3>
              {credentials.length === 0 ? <p style={{ color: '#888' }}>No credentials yet. Submit a request to DGFT.</p> : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {credentials.map((c: any) => (
                    <div key={c.id} className="card" style={{ border: c.revoked ? '2px solid #fc8181' : '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 700 }}>{c.credential_type}</span>
                          {c.revoked && <span style={{ marginLeft: '0.5rem', color: '#e53e3e', fontSize: '0.8rem' }}>[REVOKED]</span>}
                        </div>
                        <span style={{ fontSize: '0.8rem', color: '#888' }}>{new Date(c.issued_at).toLocaleDateString()}</span>
                      </div>
                      <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#555' }}>
                        Issuer: <code>{c.issuer_did_string || 'Unknown'}</code>
                      </div>
                      {c.expires_at && <div style={{ fontSize: '0.8rem', color: '#888' }}>Expires: {new Date(c.expires_at).toLocaleDateString()}</div>}
                      {!c.revoked && (
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => setQrShareId(c.id)}>
                            Share via QR
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setDidShareId(c.id)}>
                            Share to DID
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab: Employees */}
          {tab === 'employees' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div>
                <h3>Employee Registry</h3>
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <h4 style={{ marginBottom: '1rem' }}>Add Employee</h4>
                  <form onSubmit={handleAddEmployee}>
                    <div className="form-group">
                      <label>Employee ID</label>
                      <input className="form-input" value={empForm.employeeId} onChange={e => setEmpForm(f => ({ ...f, employeeId: e.target.value }))} required placeholder="EMP001" />
                    </div>
                    <div className="form-group">
                      <label>Full Name</label>
                      <input className="form-input" value={empForm.name} onChange={e => setEmpForm(f => ({ ...f, name: e.target.value }))} required />
                    </div>
                    <div className="form-group">
                      <label>Email</label>
                      <input className="form-input" type="email" value={empForm.email} onChange={e => setEmpForm(f => ({ ...f, email: e.target.value }))} required />
                    </div>
                    <button className="btn btn-primary" type="submit">Create Sub-DID</button>
                  </form>
                </div>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {employees.map((emp: any) => (
                    <div key={emp.id} className="card" style={{ padding: '0.75rem' }}>
                      <div style={{ fontWeight: 600 }}>{emp.name} <span style={{ color: '#888', fontWeight: 400 }}>({emp.employee_id})</span></div>
                      <div style={{ fontSize: '0.75rem', color: '#666' }}>{emp.email}</div>
                      <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.25rem' }}>
                        Sub-DID: <code>{emp.did_string?.slice(0, 50)}...</code>
                        <button onClick={() => navigator.clipboard?.writeText(emp.did_string)} style={{ marginLeft: '0.5rem', fontSize: '0.7rem', padding: '2px 6px', cursor: 'pointer' }}>Copy</button>
                      </div>
                    </div>
                  ))}
                  {employees.length === 0 && <p style={{ color: '#888' }}>No employees yet.</p>}
                </div>
              </div>

              <div>
                <h3>Issued to Employees</h3>
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <h4 style={{ marginBottom: '1rem' }}>Issue Internal Credential</h4>
                  <form onSubmit={handleIssueToEmployee}>
                    <div className="form-group">
                      <label>Employee</label>
                      <select className="form-input" value={issueForm.employeeRegistryId} onChange={e => setIssueForm(f => ({ ...f, employeeRegistryId: e.target.value }))} required>
                        <option value="">Select employee...</option>
                        {employees.map((emp: any) => <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_id})</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Template</label>
                      <select className="form-input" value={issueForm.credentialTemplate} onChange={e => setIssueForm(f => ({ ...f, credentialTemplate: e.target.value }))}>
                        <option value="EmploymentCertificate">Employment Certificate</option>
                        <option value="DesignationCertificate">Designation Certificate</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Credential Data (JSON)</label>
                      {issueForm.credentialTemplate === 'EmploymentCertificate' ? (
                        <textarea className="form-input" rows={5} value={issueForm.credentialData} onChange={e => setIssueForm(f => ({ ...f, credentialData: e.target.value }))}
                          placeholder={'{\n  "dateOfJoining": "2024-01-01",\n  "employeeId": "EMP001",\n  "department": "Engineering",\n  "status": "Active"\n}'} />
                      ) : (
                        <textarea className="form-input" rows={4} value={issueForm.credentialData} onChange={e => setIssueForm(f => ({ ...f, credentialData: e.target.value }))}
                          placeholder={'{\n  "currentRole": "Senior Engineer",\n  "grade": "L5",\n  "effectiveDate": "2024-01-01"\n}'} />
                      )}
                    </div>
                    <button className="btn btn-primary" type="submit">Issue & Push to Wallet</button>
                  </form>
                </div>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  {issuedByMe.map((c: any) => (
                    <div key={c.id} className="card" style={{ padding: '0.75rem', border: c.revoked ? '2px solid #fc8181' : undefined }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600 }}>{c.credential_type}</span>
                        {!c.revoked ? (
                          <button className="btn btn-secondary btn-sm" onClick={() => handleRevoke(c.id)} style={{ color: '#e53e3e' }}>Revoke</button>
                        ) : <span style={{ color: '#e53e3e', fontSize: '0.8rem' }}>REVOKED</span>}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#666' }}>{c.employee_name || 'Unknown'} ({c.employee_id})</div>
                    </div>
                  ))}
                  {issuedByMe.length === 0 && <p style={{ color: '#888' }}>No credentials issued yet.</p>}
                </div>
              </div>
            </div>
          )}

          {/* Tab: Pending Requests */}
          {tab === 'requests' && (
            <div>
              <h3>VC Requests Sent to DGFT</h3>
              {requests.length === 0 ? <p style={{ color: '#888' }}>No requests submitted yet.</p> : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {requests.map((r: any) => (
                    <div key={r.id} className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 700 }}>{r.credential_type}</span>
                        <span style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '0.8rem', background: r.status === 'approved' ? '#c6f6d5' : r.status === 'rejected' ? '#fed7d7' : '#feebc8', color: r.status === 'approved' ? '#276749' : r.status === 'rejected' ? '#c53030' : '#7b341e' }}>
                          {r.status}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
                        Submitted: {new Date(r.created_at).toLocaleString()}
                        {r.issuer_name && <> | Issuer: {r.issuer_name}</>}
                        {r.rejection_reason && <div style={{ color: '#e53e3e', marginTop: '0.25rem' }}>Reason: {r.rejection_reason}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab: Issue / Request */}
          {tab === 'issue' && (
            <div style={{ maxWidth: 560 }}>
              <h3>Request Credential from DGFT</h3>
              <div className="card">
                <form onSubmit={handleVCRequest}>
                  <div className="form-group">
                    <label>DGFT Issuer</label>
                    <select className="form-input" value={vcReqForm.issuerUserId} onChange={e => setVcReqForm(f => ({ ...f, issuerUserId: e.target.value }))}>
                      <option value="">-- Auto-select issuer --</option>
                      {issuers.map((iss: any) => (
                        <option key={iss.id} value={iss.id}>{iss.name} — {iss.did_string}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Credential Type</label>
                    <select className="form-input" value={vcReqForm.credentialType} onChange={e => setVcReqForm(f => ({ ...f, credentialType: e.target.value }))}>
                      <option value="DGFTExportLicense">DGFT Export License</option>
                      <option value="MCARegistration">MCA Registration Certificate</option>
                      <option value="IECode">Importer-Exporter Code (IEC)</option>
                      <option value="GSTCertificate">GST Registration Certificate</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Request Data (JSON)</label>
                    <textarea className="form-input" rows={6} value={vcReqForm.requestData} onChange={e => setVcReqForm(f => ({ ...f, requestData: e.target.value }))}
                      placeholder={'{\n  "companyName": "Acme Corp",\n  "registrationNumber": "U12345MH2020PLC123456",\n  "address": "Mumbai, Maharashtra"\n}'} />
                  </div>
                  <button className="btn btn-primary" type="submit">Submit Request to DGFT</button>
                </form>
              </div>
            </div>
          )}

          {/* Tab: Proof Requests from Verifiers */}
          {tab === 'proof-requests' && (
            <div>
              <h3>Proof Requests Sent to You</h3>
              <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1rem' }}>
                Verifiers can request credentials from you by targeting your DID. Respond by composing a Verifiable Presentation.
              </p>
              {proofRequests.length === 0 ? (
                <p style={{ color: '#888' }}>No proof requests targeted at your DID yet.</p>
              ) : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {proofRequests.map((r: any) => {
                    const isPending = r.status === 'pending';
                    const statusBg = isPending ? '#feebc8' : r.status === 'submitted' ? '#bee3f8' : r.status === 'approved' ? '#c6f6d5' : '#fed7d7';
                    const statusColor = isPending ? '#7b341e' : r.status === 'submitted' ? '#2a69ac' : r.status === 'approved' ? '#276749' : '#c53030';
                    return (
                      <div key={r.id} className="card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontWeight: 700 }}>From: {r.verifier_name}</div>
                            <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '0.25rem' }}>
                              Requires: <strong>{(r.required_credential_types || []).join(', ') || 'Any'}</strong>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.25rem' }}>
                              Request ID: <code>{r.id}</code>
                            </div>
                          </div>
                          <span style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '0.8rem', background: statusBg, color: statusColor }}>{r.status}</span>
                        </div>
                        {isPending && (
                          <div style={{ marginTop: '0.75rem' }}>
                            <a href={`/corporate/compose-vp?requestId=${r.id}`} className="btn btn-primary" style={{ fontSize: '0.85rem' }}>
                              Respond with Presentation
                            </a>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'corp-wallet' && (
            <div>
              <h3 style={{ marginBottom: '1rem' }}>Corporate Identity Wallet</h3>

              {/* Trust Score Banner */}
              {(() => {
                const trustScore = DIA_CONFIG.filter(d => walletVCs[d.type]).length;
                const trustLabel = trustScore === 4
                  ? 'Fully Verified (4/4)'
                  : trustScore > 0
                    ? `Partial Trust (${trustScore}/4)`
                    : 'Unverified (0/4)';
                const trustColor = trustScore === 4 ? '#28a745' : trustScore > 0 ? '#ffa500' : '#dc3545';
                return (
                  <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: trustColor }}>{trustScore}/4</div>
                    <div>
                      <div style={{ fontWeight: 600, color: trustColor }}>{trustLabel}</div>
                      <div style={{ color: '#666', fontSize: '0.875rem' }}>Decentralized Identity Attestations received</div>
                    </div>
                  </div>
                );
              })()}

              {/* 4 DIA Cards in 2x2 grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                {DIA_CONFIG.map(dia => {
                  const vc = walletVCs[dia.type];
                  return (
                    <div key={dia.type} className="card" style={{ padding: '1.25rem', border: vc ? `2px solid ${dia.badge}` : '2px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <div>
                          <span style={{ background: dia.badge, color: '#fff', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 700, marginRight: '0.5rem' }}>{dia.authority}</span>
                          <span style={{ background: '#e9ecef', color: '#495057', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>{dia.diaLabel}</span>
                        </div>
                        {vc
                          ? <span style={{ background: '#d4edda', color: '#155724', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>✓ Issued</span>
                          : <span style={{ background: '#f8d7da', color: '#721c24', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>Pending</span>
                        }
                      </div>
                      <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>{dia.label}</div>
                      {vc ? (
                        <div style={{ background: '#f8f9fa', borderRadius: 6, padding: '0.75rem' }}>
                          <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.25rem' }}>Digital Identity Anchor</div>
                          <div style={{ fontFamily: 'monospace', fontSize: '0.875rem', color: '#333', fontWeight: 600 }}>
                            {vc.credentialSubject?.[dia.anchorKey] || '—'}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.5rem' }}>
                            Issuer: {(vc.issuer || '').substring(0, 30)}...
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#aaa', fontSize: '0.875rem', fontStyle: 'italic' }}>
                          Awaiting {dia.authority} approval
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Legacy OrganizationIdentityCredential */}
              {legacyVC && (
                <div className="card" style={{ padding: '1.25rem', border: '1px dashed #ccc', marginTop: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <h4 style={{ margin: 0, color: '#666' }}>Legacy Credential</h4>
                    <span style={{ background: '#e2e8f0', color: '#555', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem' }}>OrganizationIdentityCredential</span>
                  </div>
                  <p style={{ color: '#888', fontSize: '0.875rem', margin: 0 }}>
                    This credential was issued before the multi-authority upgrade. Your new DIA credentials above supersede it.
                  </p>
                </div>
              )}

              {subRole === 'maker' && (
                <div className="card" style={{ padding: '1.25rem', marginTop: '1rem' }}>
                  <h4 style={{ marginBottom: '0.75rem' }}>Create VP Draft for Checker Approval</h4>
                  <p style={{ color: '#666', fontSize: '0.875rem', marginBottom: '1rem' }}>
                    Select credentials to share and a verifier. Your Checker will review and sign.
                  </p>
                  <VPDraftForm token={token} walletVCs={walletVCs} onSubmit={loadAll} />
                </div>
              )}
            </div>
          )}

          {tab === 'team' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0 }}>Team Members</h3>
                {subRole === 'super_admin' && (
                  <button className="btn btn-primary" style={{ padding: '0.4rem 1rem' }} onClick={() => setShowInviteForm(true)}>+ Invite Member</button>
                )}
              </div>
              {inviteMsg && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{inviteMsg}</div>}
              {showInviteForm && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                  <h4 style={{ marginBottom: '0.75rem' }}>Invite Team Member</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Email *</label>
                      <input className="form-input" type="email" value={inviteForm.email}
                        onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Name *</label>
                      <input className="form-input" value={inviteForm.name}
                        onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Sub Role *</label>
                      <select className="form-input" value={inviteForm.sub_role}
                        onChange={e => setInviteForm(f => ({ ...f, sub_role: e.target.value }))}>
                        {['admin', 'operator', 'maker', 'checker', 'member'].map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <button className="btn btn-primary" onClick={async () => {
                      try {
                        const r = await fetch('/api/corporate/team/invite', {
                          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify(inviteForm),
                        });
                        const d = await r.json();
                        if (!r.ok) throw new Error(d.error);
                        setInviteMsg(`✓ Invited! Temp password: ${d.tempPassword}`);
                        setShowInviteForm(false);
                        setInviteForm({ email: '', name: '', sub_role: 'operator' });
                        loadAll();
                      } catch (e: any) { setInviteMsg(e.message); }
                    }}>Send Invite</button>
                    <button className="btn btn-secondary" onClick={() => setShowInviteForm(false)}>Cancel</button>
                  </div>
                </div>
              )}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8f9fa' }}>
                      {['Name', 'Email', 'Sub Role', 'Joined'].map(h => (
                        <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: '#555', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {team.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No team members yet.</td></tr>
                    )}
                    {team.map((m: any) => (
                      <tr key={m.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{m.name}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: '#555' }}>{m.email}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{ background: '#e2e8f0', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>{m.sub_role || '—'}</span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#888' }}>{new Date(m.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'vp-queue' && (
            <div>
              <h3 style={{ marginBottom: '1rem' }}>Pending VP Approvals</h3>
              {vpQueue.length === 0 ? (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No pending VP drafts to review.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {vpQueue.map((action: any) => (
                    <div key={action.id} className="card" style={{ padding: '1.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>VP Draft</div>
                          <div style={{ fontSize: '0.8rem', color: '#888' }}>Submitted: {new Date(action.created_at).toLocaleString()}</div>
                          <div style={{ fontSize: '0.8rem', color: '#555', marginTop: '0.25rem' }}>
                            Credentials: {JSON.stringify(action.payload?.vc_ids || [])}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn btn-primary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.85rem' }}
                            onClick={async () => {
                              const r = await fetch(`/api/mc/${action.id}/approve`, {
                                method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
                              });
                              const d = await r.json();
                              if (r.ok) { loadAll(); }
                              else alert(d.error);
                            }}>
                            Sign &amp; Send
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.85rem', color: '#dc3545' }}
                            onClick={async () => {
                              const reason = prompt('Rejection reason:');
                              if (!reason) return;
                              const r = await fetch(`/api/mc/${action.id}/reject`, {
                                method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ reason }),
                              });
                              if (r.ok) loadAll();
                            }}>
                            Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* QR Share Modal */}
      {qrShareId && (
        <QRShareModal
          credentialId={qrShareId}
          credentialType={credentials.find((c: any) => c.id === qrShareId)?.credential_type || ''}
          onClose={() => setQrShareId(null)}
          authToken={token || ''}
        />
      )}

      {/* DID Share Modal */}
      {didShareId && (
        <ShareToDIDModal
          credentialId={didShareId}
          credentialType={credentials.find((c: any) => c.id === didShareId)?.credential_type || ''}
          onClose={() => setDidShareId(null)}
          authToken={token || ''}
        />
      )}
    </div>
  );
}
