import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { useAppShell } from '../components/AppShell';

export default function VerifierDashboard() {
  const { user, token } = useAuth();
  const { activeTab: tab, setActiveTab: setTab } = useAppShell();
  const [requests, setRequests] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [newReqTypes, setNewReqTypes] = useState<string[]>(['EmploymentCertificate']);
  const [newReqHolderDid, setNewReqHolderDid] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [receivedPresentations, setReceivedPresentations] = useState<any[]>([]);
  const credTypes = ['EmploymentCertificate', 'DesignationCertificate', 'DGFTExportLicense', 'MCARegistration', 'IECode', 'GSTCertificate'];

  useEffect(() => {
    if (tab === 'requests') loadRequests();
    if (tab === 'received') loadReceived();
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

  function showMsg(type: 'success' | 'error', text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function handleNewRequest(e: React.FormEvent) {
    e.preventDefault(); if (!token) return;
    try {
      const result = await api.requestProof(token, newReqTypes, newReqHolderDid || undefined);
      showMsg('success', `Proof request created. Request ID: ${result.request.id}`);
      setTab('requests');
    } catch (err: any) { showMsg('error', err.message); }
  }

  async function handleApprove(id: string) {
    if (!token) return;
    try {
      await api.approveVerification(token, id);
      showMsg('success', 'Verification approved');
      setSelected(null); loadRequests();
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

  const statusColor = (s: string) => s === 'approved' ? { bg: '#c6f6d5', color: '#276749' } : s === 'rejected' ? { bg: '#fed7d7', color: '#c53030' } : s === 'submitted' ? { bg: '#bee3f8', color: '#2a69ac' } : { bg: '#feebc8', color: '#7b341e' };

  return (
    <div className="page-container">
      <div style={{ marginBottom: '1.5rem' }}>
        <h1>Verifier Dashboard</h1>
        <p style={{ color: '#666' }}>{user?.name}</p>
      </div>

      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      {tab === 'new' && (
        <div style={{ maxWidth: 500 }}>
          <h3>Generate Request for Proof</h3>
          <form onSubmit={handleNewRequest} className="card">
            <div className="form-group">
              <label>Holder DID (optional — targets a specific holder)</label>
              <input className="form-input" type="text" value={newReqHolderDid} onChange={e => setNewReqHolderDid(e.target.value)} placeholder="did:web:didvc.platform:..." />
            </div>
            <div className="form-group">
              <label>Required Credential Types</label>
              <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
                {credTypes.map(t => (
                  <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={newReqTypes.includes(t)} onChange={() => setNewReqTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])} />
                    {t}
                  </label>
                ))}
              </div>
            </div>
            <button className="btn btn-primary" type="submit" style={{ marginTop: '1rem' }}>Create Proof Request</button>
          </form>
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
                      </div>
                    ))}
                  </div>
                  {selected.status === 'submitted' && (
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
                  {selected.status !== 'submitted' && selected.status !== 'pending' && (
                    <div className="alert" style={{ background: selected.status === 'approved' ? '#c6f6d5' : '#fed7d7' }}>
                      {selected.status === 'approved' ? 'Verification Approved' : `Rejected: ${selected.rejection_reason}`}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
