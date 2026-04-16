import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { useAppShell } from '../components/AppShell';
import BlockchainBadge from '../components/BlockchainBadge';
import LedgerModal from '../components/LedgerModal';

type TeamMember = {
  id: string;
  email: string;
  name: string;
  sub_role: string;
  created_at: string;
};

const SUB_ROLE_BADGE: Record<string, { bg: string; color: string }> = {
  super_admin: { bg: '#1a56db', color: '#fff' },
  maker:       { bg: '#f59e0b', color: '#fff' },
  checker:     { bg: '#10b981', color: '#fff' },
};

export default function VerifierDashboard() {
  const { user, token } = useAuth();
  const { activeTab: tab, setActiveTab: setTab } = useAppShell();
  const subRole: string = (user as any)?.sub_role || '';

  const [requests, setRequests] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [receivedPresentations, setReceivedPresentations] = useState<any[]>([]);

  // 3-step proof request form
  const [reqStep, setReqStep] = useState<1 | 2 | 3>(1);
  const [corpList, setCorpList] = useState<any[]>([]);
  const [selectedCorp, setSelectedCorp] = useState<any | null>(null);
  const [corpEmployees, setCorpEmployees] = useState<any[]>([]);
  const [empSearch, setEmpSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  const [newReqHolderDid, setNewReqHolderDid] = useState('');
  const [newReqCredTypes, setNewReqCredTypes] = useState('');
  const [newReqPurpose, setNewReqPurpose] = useState('');
  const [newReqMsg, setNewReqMsg] = useState('');
  const [newReqLoading, setNewReqLoading] = useState(false);

  const [besuResults, setPolygonResults] = useState<any[] | null>(null);
  const [ledgerVcId, setLedgerVcId] = useState<string | null>(null);
  const [ledgerCredType, setLedgerCredType] = useState<string | undefined>(undefined);

  // Team state
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', sub_role: 'maker' });
  const [tempPassword, setTempPassword] = useState('');

  const canApproveReject = !subRole || ['checker', 'super_admin'].includes(subRole);

  useEffect(() => {
    if (tab === 'new') { loadCorporates(); setReqStep(1); }
    if (tab === 'requests') loadRequests();
    if (tab === 'received') loadReceived();
    if (tab === 'team') loadTeam();
  }, [tab]);

  async function loadReceived() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.getSharedPresentations(token);
      setReceivedPresentations(data.presentations || []);
    } catch (e: any) { showMsg('error', e.message); }
    finally { setLoading(false); }
  }

  async function loadRequests() {
    if (!token) return;
    setLoading(true);
    try { const d = await api.getVerificationRequests(token); setRequests(d.requests || []); }
    catch (e: any) { showMsg('error', e.message); }
    finally { setLoading(false); }
  }

  async function loadTeam() {
    if (!token) return;
    try {
      const res = await fetch('/api/verifier/team', { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      setTeam(data.team || []);
    } catch (e: any) { showMsg('error', 'Failed to load team'); }
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function loadCorporates() {
    if (!token) return;
    try {
      const r = await fetch('/api/verifier/corporates', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setCorpList(d.corporates || []);
    } catch {}
  }

  async function loadCorpEmployees(orgId: string) {
    if (!token) return;
    try {
      const r = await fetch(`/api/verifier/corporates/${orgId}/employees`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setCorpEmployees(d.employees || []);
    } catch {}
  }

  async function handleSendProofRequest() {
    if (!selectedEmployee || !newReqCredTypes.trim()) {
      setNewReqMsg('Select an employee and specify at least one credential type');
      return;
    }
    setNewReqLoading(true);
    setNewReqMsg('');
    try {
      const credTypes = newReqCredTypes.split(',').map((s: string) => s.trim()).filter(Boolean);
      const r = await fetch('/api/verifier/request-proof', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holderDid: selectedEmployee.employee_did,
          requiredCredentialTypes: credTypes,
          purpose: newReqPurpose,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setNewReqMsg('✓ Proof request sent successfully');
      setReqStep(1);
      setSelectedCorp(null);
      setCorpEmployees([]);
      setSelectedEmployee(null);
      setNewReqHolderDid('');
      setNewReqCredTypes('');
      setNewReqPurpose('');
    } catch (err: any) {
      setNewReqMsg(err.message);
    } finally {
      setNewReqLoading(false);
    }
  }

  async function handleApprove(id: string) {
    if (!token) return;
    try {
      const result = await api.approveVerification(token, id);
      if (result?.besuResults) setPolygonResults(result.besuResults);
      showMsg('success', 'Verification approved');
      loadRequests();
      // keep selected open so user sees the on-chain results panel
      setSelected((prev: any) => prev ? { ...prev, status: 'approved' } : null);
    } catch (err: any) { showMsg('error', err.message); }
  }

  async function handleReject(id: string) {
    if (!token) return;
    try {
      await api.rejectVerification(token, id, rejectReason);
      showMsg('success', 'Verification rejected');
      setSelected(null); setRejectReason(''); loadRequests();
    } catch (err: any) { showMsg('error', err.message); }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/verifier/team/invite', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(inviteForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTempPassword(data.tempPassword);
      setShowInvite(false);
      setInviteForm({ email: '', name: '', sub_role: 'maker' });
      loadTeam();
    } catch (e: any) { showMsg('error', e.message); }
    finally { setLoading(false); }
  }

  const statusColor = (s: string) => s === 'approved' ? { bg: '#c6f6d5', color: '#276749' } : s === 'rejected' ? { bg: '#fed7d7', color: '#c53030' } : s === 'submitted' ? { bg: '#bee3f8', color: '#2a69ac' } : { bg: '#feebc8', color: '#7b341e' };

  const thStyle: React.CSSProperties = { padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: '#555', borderBottom: '1px solid #e2e8f0', background: '#f8f9fa' };
  const tdStyle: React.CSSProperties = { padding: '0.75rem 1rem', borderBottom: '1px solid #f0f0f0' };

  return (
    <div className="page-container">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1>Verifier Dashboard</h1>
        <p style={{ color: '#666' }}>{user?.name}{subRole && <span style={{ marginLeft: '0.5rem', ...SUB_ROLE_BADGE[subRole], padding: '0.15rem 0.5rem', borderRadius: 8, fontSize: '0.75rem' }}>{subRole}</span>}</p>
      </div>

      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

        {tab === 'new' && (
          <div style={{ maxWidth: 640 }}>
            <h3>New Proof Request</h3>
            <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
              Select a corporate organisation, pick an employee, then specify the credentials you need.
            </p>

            {/* Step indicators */}
            <div style={{ display: 'flex', gap: 0, marginBottom: '1.5rem' }}>
              {([1, 2, 3] as const).map(s => (
                <div key={s} style={{ flex: 1, textAlign: 'center', padding: '8px 4px', fontSize: '0.75rem', fontWeight: 600,
                  background: reqStep === s ? '#2563eb' : reqStep > s ? '#dcfce7' : '#f1f5f9',
                  color: reqStep === s ? 'white' : reqStep > s ? '#16a34a' : '#94a3b8',
                  borderRadius: s === 1 ? '8px 0 0 8px' : s === 3 ? '0 8px 8px 0' : 0,
                  border: '1px solid #e2e8f0', borderLeft: s > 1 ? 'none' : '1px solid #e2e8f0' }}>
                  {reqStep > s ? '✓ ' : `${s}. `}
                  {s === 1 ? 'Select Org' : s === 2 ? 'Select Employee' : 'Send Request'}
                </div>
              ))}
            </div>

            {/* Step 1 — Select Corporate */}
            {reqStep === 1 && (
              <div className="card">
                <h4 style={{ marginTop: 0 }}>Select Corporate Organisation</h4>
                {corpList.length === 0 ? (
                  <p style={{ color: '#888', fontSize: '0.85rem' }}>No corporate organisations found.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {corpList.map((corp: any) => (
                      <div key={corp.id}
                        onClick={() => { setSelectedCorp(corp); loadCorpEmployees(corp.id); setReqStep(2); }}
                        style={{ padding: '12px', border: `2px solid ${selectedCorp?.id === corp.id ? '#2563eb' : '#e2e8f0'}`,
                          borderRadius: 8, cursor: 'pointer', background: selectedCorp?.id === corp.id ? '#eff6ff' : 'white' }}>
                        <div style={{ fontWeight: 700 }}>{corp.name}</div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>
                          {corp.employee_count} employee(s) with portal access
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 2 — Select Employee */}
            {reqStep === 2 && selectedCorp && (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h4 style={{ margin: 0 }}>Select Employee — {selectedCorp.name}</h4>
                  <button onClick={() => { setReqStep(1); setSelectedCorp(null); setCorpEmployees([]); setSelectedEmployee(null); }}
                    style={{ fontSize: '0.75rem', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>
                    ← Back
                  </button>
                </div>
                <input
                  className="form-input"
                  placeholder="Filter by name or email..."
                  value={empSearch}
                  onChange={e => setEmpSearch(e.target.value)}
                  style={{ marginBottom: '0.75rem' }}
                />
                {corpEmployees.length === 0 ? (
                  <p style={{ color: '#888', fontSize: '0.85rem' }}>No employees with portal accounts found.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {corpEmployees
                      .filter((e: any) =>
                        !empSearch ||
                        e.name?.toLowerCase().includes(empSearch.toLowerCase()) ||
                        e.email?.toLowerCase().includes(empSearch.toLowerCase())
                      )
                      .map((emp: any) => (
                        <div key={emp.id}
                          onClick={() => { setSelectedEmployee(emp); setNewReqHolderDid(emp.employee_did); setReqStep(3); }}
                          style={{ padding: '12px', border: `2px solid ${selectedEmployee?.id === emp.id ? '#2563eb' : '#e2e8f0'}`,
                            borderRadius: 8, cursor: 'pointer', background: selectedEmployee?.id === emp.id ? '#eff6ff' : 'white' }}>
                          <div style={{ fontWeight: 700 }}>{emp.name}</div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>{emp.email}</div>
                          <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: 2, fontFamily: 'monospace' }}>
                            {emp.employee_did ? emp.employee_did.slice(0, 60) + '…' : 'No DID'}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 3 — Credential types + submit */}
            {reqStep === 3 && selectedEmployee && (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h4 style={{ margin: 0 }}>Specify Credentials</h4>
                  <button onClick={() => { setReqStep(2); }}
                    style={{ fontSize: '0.75rem', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>
                    ← Back
                  </button>
                </div>

                <div style={{ padding: '8px 12px', background: '#f0fdf4', borderRadius: 6, marginBottom: '1rem', fontSize: '0.78rem', color: '#374151' }}>
                  Sending to: <strong>{selectedEmployee.name}</strong> ({selectedEmployee.email}) at <strong>{selectedCorp?.name}</strong>
                </div>

                <div className="form-group">
                  <label style={{ fontWeight: 600 }}>Required Credential Types *</label>
                  <input
                    className="form-input"
                    placeholder="e.g. EmploymentCertificate, IECCredential"
                    value={newReqCredTypes}
                    onChange={e => setNewReqCredTypes(e.target.value)}
                  />
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 4 }}>
                    Comma-separated. Employee sees these highlighted in their wallet.
                  </div>
                </div>

                <div className="form-group">
                  <label style={{ fontWeight: 600 }}>Purpose / Note</label>
                  <input
                    className="form-input"
                    placeholder="e.g. KYC for trade finance application"
                    value={newReqPurpose}
                    onChange={e => setNewReqPurpose(e.target.value)}
                  />
                </div>

                {newReqMsg && (
                  <div style={{ marginBottom: '0.75rem', fontSize: '0.875rem', color: newReqMsg.startsWith('✓') ? '#276749' : '#dc3545' }}>
                    {newReqMsg}
                  </div>
                )}

                <button
                  className="btn btn-primary"
                  onClick={handleSendProofRequest}
                  disabled={newReqLoading}
                >
                  {newReqLoading ? 'Sending...' : 'Send Proof Request →'}
                </button>
              </div>
            )}
          </div>
        )}

      {tab === 'received' && (
        <div>
          <h3>Credentials Shared With You</h3>
          <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Credentials that holders have shared directly to your DID.
          </p>
          {loading ? <div style={{ textAlign: 'center', padding: '2rem' }}>Loading...</div> :
            receivedPresentations.length === 0 ? (
              <p style={{ color: '#888' }}>No credentials have been shared with your DID yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: '1rem' }}>
                {receivedPresentations.map((p: any) => {
                  const vp = p.vp_json || {};
                  const vcs = vp.verifiableCredential || [];
                  return (
                    <div key={p.id} className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>
                            {vcs.map((vc: any) => (vc.type || []).filter((t: string) => t !== 'VerifiableCredential').join(', ')).join(' + ') || 'Presentation'}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                            Purpose: <strong>{p.share_purpose || 'general'}</strong>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.25rem' }}>
                            From: <code>{(p.holder_did || '').slice(0, 60)}{(p.holder_did || '').length > 60 ? '...' : ''}</code>
                          </div>
                        </div>
                        <span style={{ fontSize: '0.8rem', color: '#888' }}>{new Date(p.created_at).toLocaleDateString()}</span>
                      </div>
                      {vcs.length > 0 && (
                        <div style={{ marginTop: '0.75rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem' }}>
                          {vcs.map((vc: any, i: number) => (
                            <div key={i} style={{ marginBottom: '0.5rem', background: '#f7fafc', padding: '0.5rem', borderRadius: '6px', fontSize: '0.85rem' }}>
                              <div style={{ fontWeight: 600 }}>{(vc.type || []).filter((t: string) => t !== 'VerifiableCredential').join(', ')}</div>
                              <div style={{ color: '#555', marginTop: '0.25rem' }}>Issuer: <code style={{ fontSize: '0.75rem' }}>{typeof vc.issuer === 'string' ? vc.issuer.slice(0, 50) : vc.issuer?.id?.slice(0, 50)}</code></div>
                              {vc.credentialSubject && Object.entries(vc.credentialSubject).filter(([k]) => k !== 'id').slice(0, 4).map(([k, v]: [string, any]) => (
                                <div key={k} style={{ fontSize: '0.8rem' }}><strong>{k}:</strong> {String(v)}</div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          }
        </div>
      )}

      {tab === 'requests' && (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: '1.5rem' }}>
          <div>
            {loading ? <div style={{ textAlign: 'center', padding: '2rem' }}>Loading...</div> : (
              requests.length === 0 ? <p style={{ color: '#888' }}>No verification requests yet. Create a proof request first.</p> : (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {requests.map((r: any) => {
                    const sc = statusColor(r.status);
                    return (
                      <div key={r.id} className="card" onClick={() => setSelected(r)} style={{ cursor: 'pointer', border: selected?.id === r.id ? '2px solid #1a56db' : undefined }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <span style={{ fontWeight: 600 }}>Proof Request</span>
                          <span style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '0.8rem', background: sc.bg, color: sc.color }}>{r.status}</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#555' }}>Required: {(r.required_credential_types || []).join(', ') || 'Any'}</div>
                        <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.25rem' }}>Challenge: <code>{r.challenge}</code></div>
                        <div style={{ fontSize: '0.75rem', color: '#888' }}>{new Date(r.created_at).toLocaleString()}</div>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>

          {selected && (
            <div className="card" style={{ position: 'sticky', top: '1rem', height: 'fit-content' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0 }}>Review Submission</h3>
                <button onClick={() => setSelected(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
              </div>
              {!selected.vp_json ? (
                <div>
                  <div className="alert" style={{ background: '#feebc8', color: '#7b341e' }}>No presentation submitted yet</div>
                  <div style={{ marginTop: '1rem', fontSize: '0.85rem' }}>
                    <strong>Share this challenge with the holder:</strong>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                      <code style={{ background: '#f7fafc', padding: '0.5rem', borderRadius: '4px', flex: 1, wordBreak: 'break-all' }}>{selected.challenge}</code>
                      <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(selected.challenge)}>Copy</button>
                    </div>
                    <div style={{ marginTop: '0.5rem', fontWeight: 600 }}>Request ID:</div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem' }}>
                      <code style={{ background: '#f7fafc', padding: '0.5rem', borderRadius: '4px', flex: 1, wordBreak: 'break-all' }}>{selected.id}</code>
                      <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(selected.id)}>Copy</button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: '1rem' }}>
                    <strong>Disclosed Credentials:</strong>
                    {(selected.vp_json.verifiableCredential || []).map((vc: any, i: number) => (
                      <div key={i} className="card" style={{ marginTop: '0.5rem', padding: '0.75rem', background: '#f7fafc' }}>
                        <div style={{ fontWeight: 600 }}>{(vc.type || []).filter((t: string) => t !== 'VerifiableCredential').join(', ')}</div>
                        <div style={{ fontSize: '0.8rem', color: '#555', marginTop: '0.25rem' }}>Issuer: <code>{typeof vc.issuer === 'string' ? vc.issuer : vc.issuer?.id}</code></div>
                        <div style={{ marginTop: '0.5rem' }}>
                          {Object.entries(vc.credentialSubject || {}).filter(([k]) => k !== 'id').map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', padding: '2px 0' }}>
                              <span style={{ minWidth: 120, color: '#666' }}>{k}</span>
                              <span style={{ fontWeight: 500 }}>{String(v)}</span>
                            </div>
                          ))}
                        </div>
                        {vc.proof && <div style={{ fontSize: '0.75rem', color: '#27ae60', marginTop: '0.25rem' }}>Signed by issuer</div>}
                        {vc.id && (
                          <button
                            className="btn btn-sm"
                            style={{ background: '#1a56db', color: '#fff', border: 'none', marginTop: 6 }}
                            onClick={e => { e.stopPropagation(); setLedgerVcId(vc.id); setLedgerCredType((vc.type || []).filter((t: string) => t !== 'VerifiableCredential').join(', ')); }}
                          >
                            ⛓ View on Ledger
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {selected.status === 'submitted' && canApproveReject && (
                    <>
                      <button className="btn btn-primary" style={{ width: '100%', marginBottom: '0.5rem' }} onClick={() => handleApprove(selected.id)}>
                        Approve Verification
                      </button>
                      <div className="form-group">
                        <label>Rejection Reason</label>
                        <input className="form-input" value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason..." />
                      </div>
                      <button className="btn btn-secondary" style={{ width: '100%', color: '#e53e3e' }} onClick={() => handleReject(selected.id)}>Reject</button>
                    </>
                  )}
                  {selected.status === 'submitted' && !canApproveReject && (
                    <div className="alert" style={{ background: '#bee3f8', color: '#2a69ac' }}>
                      Only checker or super_admin can approve/reject. This is read-only for your role.
                    </div>
                  )}
                  {selected.status !== 'submitted' && selected.status !== 'pending' && (
                    <div className="alert" style={{ background: selected.status === 'approved' ? '#c6f6d5' : '#fed7d7' }}>
                      {selected.status === 'approved' ? 'Verification Approved' : `Rejected: ${selected.rejection_reason}`}
                    </div>
                  )}
                  {selected.status === 'approved' && besuResults && besuResults.length > 0 && (
                    <div style={{ marginTop: '1rem', background: '#f8fafc', borderRadius: 8, padding: '1rem', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.85rem', color: '#334155' }}>
                        On-Chain Verification
                      </div>
                      {besuResults.map((r: any, i: number) => (
                        <div key={i} style={{ marginBottom: '0.5rem', paddingBottom: '0.5rem', borderBottom: i < besuResults.length - 1 ? '1px solid #e2e8f0' : 'none' }}>
                          <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '3px', fontFamily: 'monospace' }}>
                            {r.vcId ? `${r.vcId.slice(0, 30)}…` : `VC #${i + 1}`}
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 10, background: r.hashValid ? '#dcfce7' : '#fee2e2', color: r.hashValid ? '#166534' : '#991b1b' }}>
                              {r.hashValid ? 'Hash Valid' : 'Hash Mismatch'}
                            </span>
                            {r.isRevoked && (
                              <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 10, background: '#fee2e2', color: '#991b1b' }}>Revoked</span>
                            )}
                            {r.isExpired && (
                              <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 10, background: '#fef3c7', color: '#92400e' }}>Expired</span>
                            )}
                            <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: 10, background: r.onChain ? '#dcfce7' : '#f1f5f9', color: r.onChain ? '#166534' : '#64748b', border: '1px solid #e2e8f0' }}>
                              {r.onChain ? 'Live chain' : 'Demo mode'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'team' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>Team</h2>
            {subRole === 'super_admin' && (
              <button className="btn btn-primary" onClick={() => setShowInvite(true)}>+ Invite Member</button>
            )}
          </div>

          {showInvite && (
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem' }}>
              <h4 style={{ marginBottom: '1rem' }}>Invite Team Member</h4>
              <form onSubmit={handleInvite} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '0.75rem', alignItems: 'end' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Name</label>
                  <input className="form-control" required value={inviteForm.name}
                    onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Email</label>
                  <input className="form-control" type="email" required value={inviteForm.email}
                    onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Role</label>
                  <select className="form-control" value={inviteForm.sub_role}
                    onChange={e => setInviteForm(f => ({ ...f, sub_role: e.target.value }))}>
                    <option value="maker">Maker</option>
                    <option value="checker">Checker</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-primary" type="submit" disabled={loading}>Invite</button>
                  <button className="btn btn-secondary" type="button" onClick={() => setShowInvite(false)}>Cancel</button>
                </div>
              </form>
            </div>
          )}

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name', 'Email', 'Role', 'Joined'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {team.length === 0 && (
                  <tr><td colSpan={4} style={{ ...tdStyle, textAlign: 'center', color: '#888' }}>No team members yet.</td></tr>
                )}
                {team.map(m => {
                  const badge = SUB_ROLE_BADGE[m.sub_role] || { bg: '#e2e8f0', color: '#555' };
                  return (
                    <tr key={m.id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{m.name}</td>
                      <td style={tdStyle}>{m.email}</td>
                      <td style={tdStyle}>
                        <span style={{ ...badge, padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>{m.sub_role}</span>
                      </td>
                      <td style={{ ...tdStyle, color: '#888', fontSize: '0.85rem' }}>{new Date(m.created_at).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Temp Password Modal */}
          {tempPassword && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div className="card" style={{ width: 400, padding: '2.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔑</div>
                <h3 style={{ marginBottom: '1rem' }}>Member Invited</h3>
                <p style={{ marginBottom: '0.5rem', color: '#555' }}>Share this temporary password with the new member:</p>
                <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '1rem', fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 600, marginBottom: '1.5rem', wordBreak: 'break-all' }}>{tempPassword}</div>
                <button className="btn btn-primary" onClick={() => setTempPassword('')}>Done</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ledger Modal */}
      {ledgerVcId && (
        <LedgerModal
          credentialId={ledgerVcId}
          credentialType={ledgerCredType}
          token={token || ''}
          onClose={() => { setLedgerVcId(null); setLedgerCredType(undefined); }}
        />
      )}
    </div>
  );
}
