import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import QRShareModal from '../components/QRShareModal';
import ShareToDIDModal from '../components/ShareToDIDModal';
import { useAppShell } from '../components/AppShell';
import BlockchainBadge from '../components/BlockchainBadge';
import LedgerModal from '../components/LedgerModal';


const DIA_CONFIG = [
  { type: 'MCARegistration',  label: 'Company Registration', authority: 'MCA',        badge: '#1a73e8', diaLabel: 'DIA1', anchorKey: 'cinNumber' },
  { type: 'IECode',           label: 'IEC Credential',       authority: 'DGFT',       badge: '#1a56db', diaLabel: 'DIA2', anchorKey: 'ieCode' },
  { type: 'GSTINCredential',  label: 'GSTIN Credential',     authority: 'GSTN',       badge: '#28a745', diaLabel: 'DIA3', anchorKey: 'gstinNumber' },
  { type: 'PANCredential',    label: 'PAN Credential',       authority: 'Income Tax', badge: '#e67e22', diaLabel: 'DIA4', anchorKey: 'pan' },
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

function ProofRequestsTab({ proofRequests, myCredentials, corporateCredentials, token, onRefresh, isEmployee }: {
  proofRequests: any[];
  myCredentials: any[];
  corporateCredentials: any[];
  token: string | null;
  onRefresh: () => void;
  isEmployee?: boolean;
}) {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ id: string; type: 'success' | 'error'; text: string } | null>(null);
  const [peerMode, setPeerMode] = React.useState<string | null>(null); // reqId when peer mode is active
  const [peerEmail, setPeerEmail] = React.useState('');
  const [peerNote, setPeerNote] = React.useState('');

  function toggleCred(reqId: string, credId: string) {
    setSelected(s => {
      const cur = s[reqId] || [];
      return { ...s, [reqId]: cur.includes(credId) ? cur.filter(x => x !== credId) : [...cur, credId] };
    });
  }

  async function handleSubmitVP(reqId: string) {
    const credIds = selected[reqId] || [];
    if (credIds.length === 0) { setMsg({ id: reqId, type: 'error', text: 'Select at least one credential' }); return; }
    setSubmitting(reqId);
    try {
      const r = await fetch('/api/presentations/compose', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialIds: credIds, verifierRequestId: reqId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMsg({ id: reqId, type: 'success', text: '✓ Credentials shared successfully' });
      setExpanded(null);
      onRefresh();
    } catch (err: any) {
      setMsg({ id: reqId, type: 'error', text: err.message });
    } finally {
      setSubmitting(null);
    }
  }

  async function handleShareToPeer(reqId: string) {
    const credIds = selected[reqId] || [];
    if (credIds.length === 0) { setMsg({ id: reqId, type: 'error', text: 'Select at least one credential' }); return; }
    if (!peerEmail.trim()) { setMsg({ id: reqId, type: 'error', text: 'Enter peer email to share with' }); return; }
    setSubmitting(reqId);
    try {
      // Step 1: compose VP as draft (no verifierRequestId)
      const composeR = await fetch('/api/presentations/compose', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialIds: credIds }),
      });
      const composeD = await composeR.json();
      if (!composeR.ok) throw new Error(composeD.error);

      // Step 2: share to peer and link to the verifier request
      const shareR = await fetch(`/api/presentations/${composeD.presentationId}/share-to-peer`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerEmail: peerEmail.trim(), note: peerNote.trim() || null, verifierRequestId: reqId }),
      });
      const shareD = await shareR.json();
      if (!shareR.ok) throw new Error(shareD.error);

      setMsg({ id: reqId, type: 'success', text: `✓ VP sent to ${peerEmail} for peer review` });
      setExpanded(null);
      setPeerMode(null);
      setPeerEmail('');
      setPeerNote('');
      onRefresh();
    } catch (err: any) {
      setMsg({ id: reqId, type: 'error', text: err.message });
    } finally {
      setSubmitting(null);
    }
  }

  const statusBg = (s: string) => s === 'pending' ? '#feebc8' : s === 'submitted' ? '#bee3f8' : s === 'approved' ? '#c6f6d5' : '#fed7d7';
  const statusClr = (s: string) => s === 'pending' ? '#7b341e' : s === 'submitted' ? '#2a69ac' : s === 'approved' ? '#276749' : '#c53030';

  return (
    <div>
      <h3>Proof Requests</h3>
      <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1rem' }}>
        Verifiers send proof requests to your DID. Select credentials to share and respond.
      </p>
      {proofRequests.length === 0 ? (
        <p style={{ color: '#888' }}>No proof requests targeted at your DID yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: '1rem', maxWidth: 680 }}>
          {proofRequests.map((r: any) => {
            const isPending = r.status === 'pending';
            const isOpen = expanded === r.id;
            const reqMsg = msg?.id === r.id ? msg : null;
            return (
              <div key={r.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>From: {r.verifier_name || r.verifier_email || 'Verifier'}</div>
                    <div style={{ fontSize: '0.85rem', color: '#555', marginTop: 4 }}>
                      Requires: <strong>{(r.required_credential_types || []).join(', ') || 'Any'}</strong>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 4 }}>
                      {new Date(r.created_at).toLocaleString()}
                    </div>
                  </div>
                  <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: '0.8rem', background: statusBg(r.status), color: statusClr(r.status), whiteSpace: 'nowrap' }}>
                    {r.status}
                  </span>
                </div>

                {isPending && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <button
                      className="btn btn-primary"
                      style={{ fontSize: '0.85rem' }}
                      onClick={() => setExpanded(isOpen ? null : r.id)}
                    >
                      {isOpen ? 'Cancel' : 'Share Credentials'}
                    </button>
                  </div>
                )}

                {r.status === 'submitted' && (
                  <div style={{ marginTop: 8, fontSize: '0.8rem', color: '#2a69ac' }}>
                    Credentials submitted — awaiting verifier review.
                  </div>
                )}

                {r.status === 'approved' && (
                  <div style={{ marginTop: 8, fontSize: '0.8rem', color: '#276749' }}>
                    ✓ Verification approved by {r.verifier_name || 'verifier'}.
                  </div>
                )}

                {isOpen && (
                  <div style={{ marginTop: '1rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                      Select credentials to share:
                    </div>
                    {/* Employee credentials */}
                    {myCredentials.filter((c: any) => !c.revoked).length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#2563eb', marginBottom: '0.4rem' }}>
                          👤 Employee Wallet
                        </div>
                        <div style={{ display: 'grid', gap: '0.4rem' }}>
                          {myCredentials.filter((c: any) => !c.revoked).map((c: any) => {
                            const isChecked = (selected[r.id] || []).includes(c.id);
                            const isRequested = (r.required_credential_types || []).includes(c.credential_type);
                            return (
                              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.5rem', borderRadius: 6, background: isChecked ? '#eff6ff' : '#f8fafc', border: `1px solid ${isChecked ? '#1a56db' : '#e2e8f0'}` }}>
                                <input type="checkbox" checked={isChecked} onChange={() => toggleCred(r.id, c.id)} />
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{c.credential_type}</span>
                                  {isRequested && <span style={{ marginLeft: 6, fontSize: '0.68rem', background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: 8 }}>Requested</span>}
                                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Issued: {new Date(c.issued_at).toLocaleDateString()}</div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* Corporate credentials */}
                    {corporateCredentials.filter((c: any) => !c.revoked).length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed', marginBottom: '0.4rem' }}>
                          🏢 Corporate Wallet
                        </div>
                        <div style={{ display: 'grid', gap: '0.4rem' }}>
                          {corporateCredentials.filter((c: any) => !c.revoked).map((c: any) => {
                            const isChecked = (selected[r.id] || []).includes(c.id);
                            const isRequested = (r.required_credential_types || []).includes(c.credential_type);
                            return (
                              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.5rem', borderRadius: 6, background: isChecked ? '#faf5ff' : '#f8fafc', border: `1px solid ${isChecked ? '#7c3aed' : '#e2e8f0'}` }}>
                                <input type="checkbox" checked={isChecked} onChange={() => toggleCred(r.id, c.id)} />
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{c.credential_type}</span>
                                  {isRequested && <span style={{ marginLeft: 6, fontSize: '0.68rem', background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: 8 }}>Requested</span>}
                                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                    Corporate credential · {new Date(c.issued_at).toLocaleDateString()}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {myCredentials.filter((c: any) => !c.revoked).length === 0 && corporateCredentials.filter((c: any) => !c.revoked).length === 0 && (
                      <p style={{ color: '#888', fontSize: '0.85rem' }}>No credentials available to share.</p>
                    )}
                    {reqMsg && (
                      <div style={{ marginBottom: '0.5rem', fontSize: '0.875rem', color: reqMsg.type === 'success' ? '#276749' : '#dc3545' }}>{reqMsg.text}</div>
                    )}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleSubmitVP(r.id)}
                        disabled={submitting === r.id}
                      >
                        {submitting === r.id ? 'Submitting...' : 'Submit to Verifier'}
                      </button>
                      {isEmployee && (
                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '0.85rem' }}
                          onClick={() => setPeerMode(peerMode === r.id ? null : r.id)}
                          disabled={submitting === r.id}
                        >
                          🔍 Share to Peer for Review
                        </button>
                      )}
                    </div>
                    {isEmployee && peerMode === r.id && (
                      <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f0f9ff', borderRadius: 8, border: '1px solid #bae6fd' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem', color: '#0369a1' }}>
                          🔍 Peer Review — share to colleague for internal approval
                        </div>
                        <input
                          className="form-input"
                          placeholder="Peer employee email (same org)"
                          value={peerEmail}
                          onChange={e => setPeerEmail(e.target.value)}
                          style={{ marginBottom: '0.4rem', fontSize: '0.85rem' }}
                        />
                        <input
                          className="form-input"
                          placeholder="Note (optional)"
                          value={peerNote}
                          onChange={e => setPeerNote(e.target.value)}
                          style={{ marginBottom: '0.5rem', fontSize: '0.85rem' }}
                        />
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: '0.85rem' }}
                          onClick={() => handleShareToPeer(r.id)}
                          disabled={submitting === r.id}
                        >
                          {submitting === r.id ? 'Sending...' : 'Send for Peer Review'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
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
  const [vcReqForm, setVcReqForm] = useState({ credentialType: 'CompanyRegistrationCredential', requestData: '{}', issuerUserId: '' });

  // Internal issuance form
  const [issueForm, setIssueForm] = useState({ employeeRegistryId: '', credentialTemplate: 'EmploymentCertificate', credentialData: '{}' });

  const [issuers, setIssuers] = useState<any[]>([]);
  const [qrShareId, setQrShareId] = useState<string | null>(null);
  const [didShareId, setDidShareId] = useState<string | null>(null);
  const [ledgerCredId, setLedgerCredId] = useState<string | null>(null);
  const [proofRequests, setProofRequests] = useState<any[]>([]);
  const [walletVCs, setWalletVCs] = useState<Record<string, any>>({});
  const [corpWalletCredentials, setCorpWalletCredentials] = useState<any[]>([]);
  const [activeWallet, setActiveWallet] = useState<'employee' | 'corporate'>('employee');
  const [empWalletCredentials, setEmpWalletCredentials] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [empPermissions, setEmpPermissions] = useState<Record<string, string[]>>({});
  const [expandedPermEmpId, setExpandedPermEmpId] = useState<string | null>(null);
  const [permMsg, setPermMsg] = useState<{ id: string; type: 'success' | 'error'; text: string } | null>(null);
  const [legacyVC, setLegacyVC] = useState<any>(null);
  const [team, setTeam] = useState<any[]>([]);
  const [vpQueue, setVpQueue] = useState<any[]>([]);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', sub_role: 'requester' });
  const [inviteMsg, setInviteMsg] = useState('');
  const [corpQueue, setCorpQueue] = useState<any[]>([]);
  const [didQueue, setDidQueue] = useState<any[]>([]);
  const [vpReviewQueue, setVpReviewQueue] = useState<any[]>([]);
  const [sharePeerTarget, setSharePeerTarget] = useState<{ presentationId: string; email: string; note: string } | null>(null);
  const [myDidRequests, setMyDidRequests] = useState<any[]>([]);
  const [didNotifications, setDidNotifications] = useState<any[]>([]);
  const [didIssuers, setDidIssuers] = useState<any[]>([]);
  const [didReqForm, setDidReqForm] = useState({
    issuerUserId: '',
    orgName: '',
    cin: '',
    entityType: 'Private Limited',
    purpose: '',
    superAdminName: '',
    superAdminEmail: '',
    contactPerson: '',
    contactEmail: '',
    additionalNotes: '',
  });
  const subRole = (user as any)?.sub_role;
  const [empAccountModal, setEmpAccountModal] = useState<{ email: string; password: string } | null>(null);
  const CORP_CREDENTIAL_TYPES = ['IECCredential', 'MCARegistration', 'GSTINCredential', 'PANCredential', 'IBDICDigitalIdentityCredential'];

  useEffect(() => { loadAll(); }, [tab]);

  async function loadAll() {
    if (!token) return;
    setLoading(true);
    try {
      if (tab === 'credentials') {
        const data = await api.getMyCredentials(token);
        setCredentials(data.credentials || []);
        // Load DID notifications for super_admin
        if (subRole === 'super_admin') {
          try {
            const nr = await fetch('/api/corporate/did-notifications', { headers: { Authorization: `Bearer ${token}` } });
            const nd = await nr.json();
            setDidNotifications(nd.notifications || []);
          } catch { /* silent */ }
        }
      } else if (tab === 'employees') {
        const [emp, issued] = await Promise.all([api.getEmployees(token), api.getIssuedByMe(token)]);
        setEmployees(emp.employees || []);
        setIssuedByMe(issued.credentials || []);
      } else if (tab === 'issue' || tab === 'request-vc') {
        const data = await api.getIssuers(token);
        setIssuers(data.issuers || []);
      } else if (tab === 'request-did') {
        const data = await api.getIssuers(token);
        const all = data.issuers || [];
        setDidIssuers(all.filter((iss: any) => iss.entity_type === 'did_issuer'));
        // Pre-fill super admin from team if requester
        const teamR = await fetch('/api/corporate/team', { headers: { Authorization: `Bearer ${token}` } });
        const teamD = await teamR.json();
        const sa = (teamD.team || []).find((m: any) => m.sub_role === 'super_admin');
        if (sa) {
          setDidReqForm(f => ({
            ...f,
            superAdminName:  f.superAdminName  || sa.name  || '',
            superAdminEmail: f.superAdminEmail || sa.email || '',
          }));
        }
      } else if (tab === 'proof-requests') {
        const [prData, credData, corpData] = await Promise.all([
          api.getMyVerificationRequests(token),
          api.getMyCredentials(token),
          fetch('/api/holder/corporate-wallet', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        ]);
        setProofRequests(prData.requests || []);
        setCredentials(credData.credentials || []);
        setCorpWalletCredentials(corpData.credentials || []);
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
      } else if (tab === 'my-wallets') {
        const [empData, corpData] = await Promise.all([
          fetch('/api/credentials/my', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
          fetch('/api/holder/corporate-wallet', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        ]);
        setEmpWalletCredentials(empData.credentials || []);
        setCorpWalletCredentials(corpData.credentials || []);
        setActiveWallet('employee');
      } else if (tab === 'transactions') {
        const r = await fetch('/api/holder/transactions', { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        setTransactions(d.transactions || []);
      } else if (tab === 'team') {
        const r = await fetch('/api/corporate/team', { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        setTeam(d.team || []);
      } else if (tab === 'vp-queue') {
        const r = await fetch('/api/mc/queue?resource_type=vp_share', { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        setVpQueue(d.actions || []);
      } else if (tab === 'did-issued') {
        try {
          const r = await fetch('/api/corporate/signatory/issued-dids', { headers: { Authorization: `Bearer ${token}` } });
          const d = await r.json();
          setDidNotifications(d.issued_dids || []);
        } catch { /* silent */ }
      } else if (tab === 'corp-queue' || tab === 'checker-queue' || tab === 'signatory-queue') {
        const [vcR, didR] = await Promise.all([
          fetch('/api/corporate/vc-requests/queue', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/corporate/did-requests/queue', { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const vcD = await vcR.json();
        const didD = await didR.json();
        setCorpQueue(vcD.requests || []);
        setDidQueue(didD.requests || []);
      } else if (tab === 'requests') {
        const [vcData, didData] = await Promise.all([
          api.getMyVCRequests(token),
          fetch('/api/corporate/did-requests/my', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        ]);
        setRequests(vcData.requests || []);
        setMyDidRequests(didData.requests || []);
      } else if (tab === 'vp-review') {
        const r = await fetch('/api/employee/vp-pending-review', { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        setVpReviewQueue(d.presentations || []);
      }
    } catch (e: any) { showMsg('error', e.message); }
    finally { setLoading(false); }
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }

  async function loadEmpPermissions(empRegistryId: string) {
    if (!token) return;
    const r = await fetch(`/api/corporate/employees/${empRegistryId}/permissions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await r.json();
    setEmpPermissions(prev => ({ ...prev, [empRegistryId]: d.credential_types || [] }));
  }

  async function toggleEmpPermission(empRegistryId: string, credType: string) {
    const current = empPermissions[empRegistryId] || [];
    const updated = current.includes(credType)
      ? current.filter(t => t !== credType)
      : [...current, credType];
    setEmpPermissions(prev => ({ ...prev, [empRegistryId]: updated }));
  }

  async function saveEmpPermissions(empRegistryId: string) {
    if (!token) return;
    const types = empPermissions[empRegistryId] || [];
    try {
      const r = await fetch(`/api/corporate/employees/${empRegistryId}/permissions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential_types: types }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setPermMsg({ id: empRegistryId, type: 'success', text: '✓ Permissions saved' });
    } catch (err: any) {
      setPermMsg({ id: empRegistryId, type: 'error', text: err.message });
    }
    setTimeout(() => setPermMsg(null), 3000);
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
      const msg = subRole === 'requester'
        ? 'Request submitted for internal review (Maker → Checker → Authorized Signatory)'
        : 'Credential request submitted to issuer';
      showMsg('success', msg);
      setVcReqForm(f => ({ ...f, requestData: '{}' }));
    } catch (err: any) { showMsg('error', err.message); }
  }

  async function handleCorpAction(id: string, type: 'vc' | 'did', stage: string, decision: string, reason?: string) {
    if (!token) return;
    const base = type === 'vc' ? '/api/corporate/vc-requests' : '/api/corporate/did-requests';
    try {
      const r = await fetch(`${base}/${id}/${stage}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, rejection_reason: reason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      showMsg('success', decision === 'approve' ? '✓ Approved successfully' : '✓ Rejected');
      loadAll();
    } catch (err: any) { showMsg('error', err.message); }
  }

  async function handleCorpReject(id: string, type: 'vc' | 'did', stage: string) {
    const reason = window.prompt('Rejection reason (optional):');
    if (reason === null) return;
    await handleCorpAction(id, type, stage, 'reject', reason || undefined);
  }

  async function handleDIDRequestSubmit(e: React.FormEvent) {
    e.preventDefault(); if (!token) return;
    if (!didReqForm.orgName.trim()) { showMsg('error', 'Organisation Name is required'); return; }
    if (!didReqForm.purpose.trim()) { showMsg('error', 'Purpose is required'); return; }
    try {
      const request_data = {
        orgName:          didReqForm.orgName.trim(),
        cin:              didReqForm.cin.trim(),
        entityType:       didReqForm.entityType,
        superAdminName:   didReqForm.superAdminName.trim(),
        superAdminEmail:  didReqForm.superAdminEmail.trim(),
        contactPerson:    didReqForm.contactPerson.trim(),
        contactEmail:     didReqForm.contactEmail.trim(),
        additionalNotes:  didReqForm.additionalNotes.trim(),
      };
      const r = await fetch('/api/corporate/did-requests', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose:      didReqForm.purpose.trim(),
          issuerUserId: didReqForm.issuerUserId || undefined,
          request_data,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      showMsg('success', subRole === 'requester'
        ? 'DID request submitted — Maker → Checker → Authorised Signatory → Issuer'
        : 'DID request submitted to issuer for issuance');
      setDidReqForm({ issuerUserId: '', orgName: '', cin: '', entityType: 'Private Limited', purpose: '', superAdminName: '', superAdminEmail: '', contactPerson: '', contactEmail: '', additionalNotes: '' });
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

  async function handleCreateEmpAccount(empId: string) {
    if (!token) return;
    try {
      const r = await fetch(`/api/corporate/employees/${empId}/create-account`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (d.tempPassword) {
        setEmpAccountModal({ email: d.email, password: d.tempPassword });
      } else {
        showMsg('success', d.message || 'Account linked successfully');
      }
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
              {/* DID Notifications panel — super_admin only */}
              {subRole === 'super_admin' && didNotifications.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <h3 style={{ margin: 0, color: '#7c3aed' }}>🔑 DIDs Shared by Authorized Signatory</h3>
                    <span style={{ background: '#7c3aed', color: '#fff', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>
                      {didNotifications.length}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    {didNotifications.map((n: any) => (
                      <div key={n.id} style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 10, padding: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                          <span style={{ fontWeight: 700, color: '#6d28d9', fontSize: '0.9rem' }}>🏛 DID Issued &amp; Shared</span>
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{new Date(n.as_shared_to_admin_at).toLocaleString()}</span>
                        </div>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#1e40af', background: '#eff6ff', borderRadius: 6, padding: '0.5rem', marginBottom: '0.5rem', wordBreak: 'break-all' as const }}>
                          {n.did_string}
                        </div>
                        {n.purpose && <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.25rem' }}>Purpose: {n.purpose}</div>}
                        {n.signatory_name && (
                          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                            Shared by: <strong>{n.signatory_name}</strong> ({n.signatory_email})
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                      <div style={{ marginTop: '0.5rem' }}>
                        <BlockchainBadge txHash={c.polygon_tx_hash} blockNumber={c.polygon_block_number} />
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-sm"
                          style={{ background: '#1a56db', color: '#fff', border: 'none' }}
                          onClick={() => setLedgerCredId(c.id)}
                        >
                          ⛓ View on Ledger
                        </button>
                        {!c.revoked && (
                          <>
                            <button className="btn btn-secondary btn-sm" onClick={() => setQrShareId(c.id)}>
                              Share via QR
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => setDidShareId(c.id)}>
                              Share to DID
                            </button>
                          </>
                        )}
                      </div>
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
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{emp.name} <span style={{ color: '#888', fontWeight: 400 }}>({emp.employee_id})</span></div>
                          <div style={{ fontSize: '0.75rem', color: '#666' }}>{emp.email}</div>
                          <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '0.25rem' }}>
                            Sub-DID: <code>{emp.did_string?.slice(0, 48)}...</code>
                            <button onClick={() => navigator.clipboard?.writeText(emp.did_string)} style={{ marginLeft: '0.5rem', fontSize: '0.7rem', padding: '2px 6px', cursor: 'pointer' }}>Copy</button>
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                          {emp.user_id ? (
                            <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: '#dcfce7', color: '#166534', whiteSpace: 'nowrap' }}>
                              ✓ Portal Access
                            </span>
                          ) : (
                            ['super_admin', 'admin'].includes(subRole) && (
                              <button
                                className="btn btn-sm"
                                style={{ background: '#1a56db', color: '#fff', border: 'none', fontSize: '0.72rem', padding: '4px 10px', cursor: 'pointer', borderRadius: 6, whiteSpace: 'nowrap' }}
                                onClick={() => handleCreateEmpAccount(emp.id)}
                              >
                                + Create Login
                              </button>
                            )
                          )}
                        </div>
                      </div>
                      {/* Credential Sharing Permissions — admin only */}
                      {['super_admin', 'admin'].includes(subRole) && (
                        <div style={{ marginTop: '0.75rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem' }}>
                          <button
                            style={{ fontSize: '0.75rem', color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}
                            onClick={() => {
                              const newId = expandedPermEmpId === emp.id ? null : emp.id;
                              setExpandedPermEmpId(newId);
                              if (newId) loadEmpPermissions(emp.id);
                            }}
                          >
                            {expandedPermEmpId === emp.id ? '▲ Hide Permissions' : '▼ Credential Sharing Permissions'}
                          </button>
                          {expandedPermEmpId === emp.id && (
                            <div style={{ marginTop: '0.5rem' }}>
                              <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: '0.5rem' }}>
                                Select which corporate credentials this employee can share on behalf of the organisation:
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '0.75rem' }}>
                                {CORP_CREDENTIAL_TYPES.map(ct => (
                                  <label key={ct} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem' }}>
                                    <input
                                      type="checkbox"
                                      checked={(empPermissions[emp.id] || []).includes(ct)}
                                      onChange={() => toggleEmpPermission(emp.id, ct)}
                                    />
                                    {ct}
                                  </label>
                                ))}
                              </div>
                              {permMsg?.id === emp.id && permMsg && (
                                <div style={{ fontSize: '0.75rem', color: permMsg.type === 'success' ? '#276749' : '#dc3545', marginBottom: '0.5rem' }}>
                                  {permMsg.text}
                                </div>
                              )}
                              <button
                                className="btn btn-primary"
                                style={{ fontSize: '0.75rem', padding: '4px 12px' }}
                                onClick={() => saveEmpPermissions(emp.id)}
                              >
                                Save Permissions
                              </button>
                            </div>
                          )}
                        </div>
                      )}
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

          {/* Tab: My Requests (for Requesters) */}
          {tab === 'requests' && (
            <div>
              <h3>My Credential Requests</h3>
              {requests.length === 0 ? <p style={{ color: '#888' }}>No credential requests submitted yet.</p> : (
                <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
                  {requests.map((r: any) => {
                    const stages = ['submitted','maker_reviewed','checker_approved','signatory_approved'];
                    const stageLabels = ['Submitted','Maker Reviewed','Checker Approved','Signatory Signed'];
                    const stageIdx = stages.indexOf(r.corp_status);
                    return (
                      <div key={r.id} className="card">
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 700 }}>{r.credential_type}</span>
                          <span style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '0.8rem',
                            background: r.status === 'approved' ? '#c6f6d5' : r.status === 'rejected' ? '#fed7d7' : r.status === 'draft' ? '#e0e7ff' : '#feebc8',
                            color: r.status === 'approved' ? '#276749' : r.status === 'rejected' ? '#c53030' : r.status === 'draft' ? '#3730a3' : '#7b341e' }}>
                            {r.status === 'draft' ? 'In Review' : r.status}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
                          Submitted: {new Date(r.created_at).toLocaleString()}
                          {r.issuer_name && <> | Issuer: {r.issuer_name}</>}
                          {r.rejection_reason && <div style={{ color: '#e53e3e', marginTop: '0.25rem' }}>Reason: {r.rejection_reason}</div>}
                        </div>
                        {r.corp_status && (
                          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' as const }}>
                            {stages.map((stage, i) => (
                              <span key={stage} style={{ padding: '2px 7px', borderRadius: 8, fontSize: '0.68rem',
                                background: i <= stageIdx ? '#dcfce7' : '#f1f5f9',
                                color: i <= stageIdx ? '#16a34a' : '#94a3b8',
                                fontWeight: i <= stageIdx ? 600 : 400 }}>
                                {i <= stageIdx ? '✓ ' : ''}{stageLabels[i]}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <h3>My DID Requests</h3>
              {myDidRequests.length === 0 ? <p style={{ color: '#888' }}>No DID requests submitted yet.</p> : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {myDidRequests.map((r: any) => {
                    const stages = ['submitted','maker_reviewed','checker_approved','signatory_approved','completed'];
                    const stageLabels = ['Submitted','Maker Reviewed','Checker Approved','Signatory Signed','DID Created'];
                    const stageIdx = stages.indexOf(r.corp_status);
                    const statusColor = r.corp_status === 'completed' ? '#276749' : r.corp_status === 'rejected' ? '#c53030' : '#3730a3';
                    const statusBg = r.corp_status === 'completed' ? '#c6f6d5' : r.corp_status === 'rejected' ? '#fed7d7' : '#e0e7ff';
                    return (
                      <div key={r.id} className="card">
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 700 }}>🔑 DID Creation Request</span>
                          <span style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '0.8rem', background: statusBg, color: statusColor }}>
                            {r.corp_status}
                          </span>
                        </div>
                        {r.purpose && <div style={{ fontSize: '0.82rem', color: '#555', marginTop: 4 }}>Purpose: {r.purpose}</div>}
                        <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.5rem' }}>
                          Submitted: {new Date(r.created_at).toLocaleString()}
                          {r.rejection_reason && <div style={{ color: '#e53e3e', marginTop: '0.25rem' }}>Reason: {r.rejection_reason}</div>}
                        </div>
                        {r.corp_status !== 'rejected' && (
                          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' as const }}>
                            {stages.map((stage, i) => (
                              <span key={stage} style={{ padding: '2px 7px', borderRadius: 8, fontSize: '0.68rem',
                                background: i <= stageIdx ? '#dcfce7' : '#f1f5f9',
                                color: i <= stageIdx ? '#16a34a' : '#94a3b8',
                                fontWeight: i <= stageIdx ? 600 : 400 }}>
                                {i <= stageIdx ? '✓ ' : ''}{stageLabels[i]}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Request VC ── */}
          {(tab === 'issue' || tab === 'request-vc') && (
            <div style={{ maxWidth: 600 }}>
              <div style={{ marginBottom: '1.25rem' }}>
                <h3 style={{ margin: 0 }}>Request Credential from Issuer</h3>
                <p style={{ margin: '4px 0 0', fontSize: '0.83rem', color: '#64748b' }}>
                  Select a credential type — the system routes your request to the correct issuer automatically.
                </p>
              </div>

              <div className="card" style={{ padding: '0.6rem 1rem', marginBottom: '1rem', background: '#f8fafc', fontSize: '0.8rem', color: '#64748b', display: 'flex', gap: '1rem', flexWrap: 'wrap' as const }}>
                <span>🏛 <strong>DID Issuer</strong>: Company · IEC · IBDIC Identity</span>
                <span>📋 <strong>VC Issuer</strong>: NeSL · GSTN</span>
                <span>🔏 <strong>Trust Endorser</strong>: PAN (Protean)</span>
              </div>

              <div className="card">
                <form onSubmit={handleVCRequest}>
                  <div className="form-group">
                    <label>Credential Type <span style={{ color: '#e53e3e' }}>*</span></label>
                    <select className="form-input" value={vcReqForm.credentialType}
                      onChange={e => setVcReqForm(f => ({ ...f, credentialType: e.target.value, issuerUserId: '' }))}>
                      <optgroup label="MCA — Company Identity">
                        <option value="MCARegistration">Company Registration (MCA)</option>
                      </optgroup>
                      <optgroup label="DGFT — Trade &amp; Export">
                        <option value="IECCredential">Importer-Exporter Code (IEC)</option>
                        <option value="DGFTExportLicense">Export License</option>
                        <option value="TradeLicense">Trade License</option>
                      </optgroup>
                      <optgroup label="IBDIC — Digital Identity">
                        <option value="IBDICDigitalIdentityCredential">Digital Identity Credential</option>
                      </optgroup>
                      <optgroup label="NeSL — Business &amp; MSME">
                        <option value="NESLBusinessRegistrationCredential">Business Registration</option>
                        <option value="MSMERegistration">MSME Registration</option>
                      </optgroup>
                      <optgroup label="GSTN — Tax">
                        <option value="GSTINCredential">GSTIN Certificate</option>
                      </optgroup>
                      <optgroup label="Protean — PAN">
                        <option value="PANCredential">PAN Credential</option>
                      </optgroup>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Issuer <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>(auto-routed by type — override if needed)</span></label>
                    <select className="form-input" value={vcReqForm.issuerUserId}
                      onChange={e => setVcReqForm(f => ({ ...f, issuerUserId: e.target.value }))}>
                      <option value="">— Auto-select based on credential type —</option>
                      {issuers.map((iss: any) => (
                        <option key={iss.id} value={iss.id}>
                          {iss.name} [{iss.entity_type?.replace(/_/g, ' ')}]
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Request Data (JSON)</label>
                    <textarea className="form-input" rows={6} value={vcReqForm.requestData}
                      onChange={e => setVcReqForm(f => ({ ...f, requestData: e.target.value }))}
                      placeholder={
                        vcReqForm.credentialType === 'MCARegistration'
                          ? '{\n  "cinNumber": "U12345MH2020PLC123456",\n  "companyName": "XYZ Pvt Ltd"\n}'
                          : vcReqForm.credentialType === 'IBDICDigitalIdentityCredential'
                          ? '{\n  "entityName": "XYZ Private Limited",\n  "cin": "U12345MH2000PTC123456",\n  "category": "Private Limited"\n}'
                          : vcReqForm.credentialType === 'NESLBusinessRegistrationCredential'
                          ? '{\n  "companyName": "XYZ Private Limited",\n  "registrationNumber": "U12345MH2000PTC123456",\n  "jurisdiction": "Maharashtra"\n}'
                          : vcReqForm.credentialType === 'GSTINCredential'
                          ? '{\n  "gstin": "27ABCDE1234F1Z5",\n  "legalName": "XYZ Pvt Ltd"\n}'
                          : vcReqForm.credentialType === 'PANCredential'
                          ? '{\n  "panNumber": "ABCDE1234F",\n  "entityName": "XYZ Pvt Ltd"\n}'
                          : vcReqForm.credentialType === 'IECCredential'
                          ? '{\n  "iecCode": "0000000",\n  "entityName": "XYZ Pvt Ltd"\n}'
                          : '{\n  "companyName": "XYZ Pvt Ltd",\n  "address": "Mumbai, Maharashtra"\n}'
                      } />
                  </div>
                  <button className="btn btn-primary" type="submit">
                    {subRole === 'requester' ? '📋 Submit for Internal Review' : '📤 Submit Credential Request'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* ── Tab: Request DID ── */}
          {tab === 'request-did' && (
            <div style={{ maxWidth: 640 }}>
              <div style={{ marginBottom: '1.25rem' }}>
                <h3 style={{ margin: 0 }}>Request DID Issuance</h3>
                <p style={{ margin: '4px 0 0', fontSize: '0.83rem', color: '#64748b' }}>
                  Request a Decentralised Identifier (DID) from a DID Issuer. The request goes through your organisation's internal approval chain before reaching the issuer.
                </p>
              </div>

              <div className="card">
                <form onSubmit={handleDIDRequestSubmit}>

                  {/* Issuer selector */}
                  <div className="form-group">
                    <label>DID Issuer <span style={{ color: '#e53e3e' }}>*</span></label>
                    <select className="form-input" value={didReqForm.issuerUserId}
                      onChange={e => setDidReqForm(f => ({ ...f, issuerUserId: e.target.value }))}>
                      <option value="">— Select DID Issuer —</option>
                      {didIssuers.length > 0
                        ? didIssuers.map((iss: any) => (
                            <option key={iss.id} value={iss.id}>
                              {iss.name}
                            </option>
                          ))
                        : (
                          <>
                            <option value="ibdic">IBDIC — Indian Banks' Digital Infrastructure Company</option>
                            <option value="dgft">DGFT — Directorate General of Foreign Trade</option>
                          </>
                        )
                      }
                    </select>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '0.75rem 0' }} />

                  {/* Organisation details */}
                  <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.5rem' }}>
                    Organisation Details
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Organisation Name <span style={{ color: '#e53e3e' }}>*</span></label>
                      <input className="form-input" required value={didReqForm.orgName}
                        onChange={e => setDidReqForm(f => ({ ...f, orgName: e.target.value }))}
                        placeholder="e.g. FSV Labs Private Limited" />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>CIN / Registration No.</label>
                      <input className="form-input" value={didReqForm.cin}
                        onChange={e => setDidReqForm(f => ({ ...f, cin: e.target.value }))}
                        placeholder="e.g. U72900MH2022PTC382154" />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Entity Type</label>
                      <select className="form-input" value={didReqForm.entityType}
                        onChange={e => setDidReqForm(f => ({ ...f, entityType: e.target.value }))}>
                        <option>Private Limited</option>
                        <option>Public Limited</option>
                        <option>LLP</option>
                        <option>Partnership Firm</option>
                        <option>Sole Proprietorship</option>
                        <option>Section 8 Company</option>
                        <option>Government Entity</option>
                        <option>Other</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Purpose <span style={{ color: '#e53e3e' }}>*</span></label>
                      <select className="form-input" value={didReqForm.purpose}
                        onChange={e => setDidReqForm(f => ({ ...f, purpose: e.target.value }))}>
                        <option value="">— Select purpose —</option>
                        <option value="Corporate Digital Identity">Corporate Digital Identity</option>
                        <option value="Trade Finance & Export">Trade Finance &amp; Export</option>
                        <option value="Banking & Financial Services">Banking &amp; Financial Services</option>
                        <option value="Supply Chain Management">Supply Chain Management</option>
                        <option value="Regulatory Compliance">Regulatory Compliance</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '0.75rem 0' }} />

                  {/* Super admin details */}
                  <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.5rem' }}>
                    Corporate Super Admin
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Super Admin Name <span style={{ color: '#e53e3e' }}>*</span></label>
                      <input className="form-input" required value={didReqForm.superAdminName}
                        onChange={e => setDidReqForm(f => ({ ...f, superAdminName: e.target.value }))}
                        placeholder="Full name of authorised super admin" />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Super Admin Email <span style={{ color: '#e53e3e' }}>*</span></label>
                      <input className="form-input" required type="email" value={didReqForm.superAdminEmail}
                        onChange={e => setDidReqForm(f => ({ ...f, superAdminEmail: e.target.value }))}
                        placeholder="admin@company.com" />
                    </div>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '0.75rem 0' }} />

                  {/* Contact details */}
                  <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.5rem' }}>
                    Contact Details
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Contact Person</label>
                      <input className="form-input" value={didReqForm.contactPerson}
                        onChange={e => setDidReqForm(f => ({ ...f, contactPerson: e.target.value }))}
                        placeholder="Authorised contact name" />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Contact Email</label>
                      <input className="form-input" type="email" value={didReqForm.contactEmail}
                        onChange={e => setDidReqForm(f => ({ ...f, contactEmail: e.target.value }))}
                        placeholder="contact@company.com" />
                    </div>
                  </div>

                  <div className="form-group" style={{ marginTop: '0.75rem' }}>
                    <label>Additional Notes</label>
                    <textarea className="form-input" rows={2} value={didReqForm.additionalNotes}
                      onChange={e => setDidReqForm(f => ({ ...f, additionalNotes: e.target.value }))}
                      placeholder="Any additional context for the issuer reviewers..." />
                  </div>

                  {/* Approval chain */}
                  {subRole === 'requester' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 0.9rem', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, fontSize: '0.78rem', color: '#0369a1', margin: '0.75rem 0', flexWrap: 'wrap' as const }}>
                      <span style={{ fontWeight: 600 }}>Approval chain:</span>
                      <span>📋 Requester</span><span style={{ color: '#94a3b8' }}>→</span>
                      <span>🔍 Maker</span><span style={{ color: '#94a3b8' }}>→</span>
                      <span>✅ Checker</span><span style={{ color: '#94a3b8' }}>→</span>
                      <span>✍️ Authorised Signatory</span><span style={{ color: '#94a3b8' }}>→</span>
                      <span style={{ fontWeight: 700 }}>🏛 DID Issuer</span>
                    </div>
                  )}

                  <button className="btn btn-primary" type="submit">
                    🔑 {subRole === 'requester' ? 'Submit DID Request for Review' : 'Submit to DID Issuer'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Tab: Proof Requests from Verifiers */}
          {tab === 'proof-requests' && (
            <ProofRequestsTab
              proofRequests={proofRequests}
              myCredentials={credentials}
              corporateCredentials={corpWalletCredentials}
              token={token}
              onRefresh={loadAll}
              isEmployee={subRole === 'employee'}
            />
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

          {tab === 'my-wallets' && (
            <div>
              <h3>My Wallets</h3>
              <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                Your personal credentials and corporate credentials you are authorised to share.
              </p>
              <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', width: 'fit-content', marginBottom: '1.5rem' }}>
                <button
                  onClick={() => setActiveWallet('employee')}
                  style={{ padding: '8px 20px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                    background: activeWallet === 'employee' ? '#2563eb' : '#f8fafc',
                    color: activeWallet === 'employee' ? 'white' : '#64748b' }}
                >
                  👤 Employee Wallet
                </button>
                <button
                  onClick={() => setActiveWallet('corporate')}
                  style={{ padding: '8px 20px', border: 'none', borderLeft: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                    background: activeWallet === 'corporate' ? '#7c3aed' : '#f8fafc',
                    color: activeWallet === 'corporate' ? 'white' : '#64748b' }}
                >
                  🏢 Corporate Wallet
                </button>
              </div>
              {activeWallet === 'employee' && (
                <div>
                  <p style={{ fontSize: '0.8rem', color: '#3b82f6', background: '#eff6ff', padding: '8px 12px', borderRadius: 6, marginBottom: '1rem' }}>
                    ℹ️ These are credentials issued directly to your identity. Only you can share them.
                  </p>
                  {empWalletCredentials.length === 0 ? (
                    <p style={{ color: '#888' }}>No credentials in your employee wallet yet.</p>
                  ) : (
                    <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 600 }}>
                      {empWalletCredentials.filter((c: any) => !c.revoked).map((c: any) => (
                        <div key={c.id} className="card" style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.credential_type}</div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                                {c.issuer_did_string ? `Issued by: ${c.issuer_did_string.split(':').pop()}` : 'Issuer unknown'}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>
                                {new Date(c.issued_at).toLocaleDateString()}
                              </div>
                            </div>
                            <span style={{ background: '#dcfce7', color: '#16a34a', fontSize: '0.65rem', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>ACTIVE</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {activeWallet === 'corporate' && (
                <div>
                  <p style={{ fontSize: '0.8rem', color: '#7c3aed', background: '#faf5ff', border: '1px solid #e9d5ff', padding: '8px 12px', borderRadius: 6, marginBottom: '1rem' }}>
                    🔐 Corporate credentials you are authorised to share on behalf of your organisation. Contact admin to change permissions.
                  </p>
                  {corpWalletCredentials.length === 0 ? (
                    <p style={{ color: '#888' }}>No corporate credentials are currently authorised for sharing. Contact your admin.</p>
                  ) : (
                    <div style={{ display: 'grid', gap: '0.75rem', maxWidth: 600 }}>
                      {corpWalletCredentials.map((c: any) => (
                        <div key={c.id} className="card" style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.credential_type}</div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                                {c.issuer_did_string ? `Issued by: ${c.issuer_did_string.split(':').pop()}` : 'Issuer unknown'}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>
                                {new Date(c.issued_at).toLocaleDateString()}
                              </div>
                            </div>
                            <span style={{ background: '#dcfce7', color: '#16a34a', fontSize: '0.65rem', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>CAN SHARE</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'transactions' && (
            <div>
              <h3>Transactions</h3>
              <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                All credential sharing activity — proof requests received and presentations submitted.
              </p>
              {transactions.length === 0 ? (
                <p style={{ color: '#888' }}>No transactions yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 680 }}>
                  {transactions.map((tx: any) => {
                    const isInbound = tx.direction === 'inbound';
                    const borderColor = isInbound ? '#3b82f6' : '#16a34a';
                    const bgColor = isInbound ? '#eff6ff' : '#f0fdf4';
                    const statusBg = tx.status === 'pending' ? '#feebc8' : tx.status === 'submitted' ? '#bee3f8' : tx.status === 'approved' ? '#c6f6d5' : '#fed7d7';
                    const statusClr = tx.status === 'pending' ? '#7b341e' : tx.status === 'submitted' ? '#2a69ac' : tx.status === 'approved' ? '#276749' : '#c53030';
                    const types = Array.isArray(tx.required_credential_types) ? tx.required_credential_types.join(', ') : (tx.required_credential_types || '');
                    return (
                      <div key={tx.id} style={{ borderLeft: `3px solid ${borderColor}`, background: bgColor, borderRadius: '0 8px 8px 0', padding: '10px 14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                            {isInbound ? '📥' : '📤'} {tx.title}
                          </div>
                          <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                            {new Date(tx.created_at).toLocaleString()}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#374151', marginTop: 4 }}>
                          {isInbound
                            ? <span><strong>{tx.counterparty_name || tx.counterparty_email}</strong> requested: <strong>{types || 'credentials'}</strong></span>
                            : <span>Shared <strong>{types || 'credentials'}</strong> with <strong>{tx.counterparty_name || tx.counterparty_email}</strong></span>
                          }
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <span style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: 8, fontWeight: 600, background: statusBg, color: statusClr }}>
                            {tx.status?.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    );
                  })}
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
                        <option value="requester">Requester (Submitter)</option>
                        <option value="maker">Maker (Reviewer)</option>
                        <option value="checker">Checker</option>
                        <option value="authorized_signatory">Authorized Signatory</option>
                        <option value="admin">Admin</option>
                        <option value="operator">Operator</option>
                        <option value="member">Member</option>
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

          {/* Tab: Maker Review Queue */}
          {tab === 'corp-queue' && (() => {
            const stageLabel = 'submitted';
            const stageEndpoint = 'maker-review';
            return (
              <div>
                <h3 style={{ marginBottom: 4 }}>Review Queue <span style={{ fontSize: '0.8rem', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 12, marginLeft: 8 }}>{corpQueue.length} pending</span></h3>
                <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Review requests submitted by Requesters. Approve to forward to Checker, or reject.
                </p>
                <h4 style={{ marginBottom: 8, color: '#334155' }}>VC / Credential Requests</h4>
                {corpQueue.length === 0 ? (
                  <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: '#888', marginBottom: '1rem' }}>No credential requests pending your review</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                    {corpQueue.map((r: any) => (
                      <div key={r.id} className="card" style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <span style={{ fontWeight: 700 }}>{r.credential_type}</span>
                            <span style={{ marginLeft: 8, fontSize: '0.72rem', background: '#fef3c7', color: '#92400e', padding: '2px 7px', borderRadius: 12 }}>From Requester</span>
                          </div>
                          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(r.created_at).toLocaleString()}</span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', margin: '4px 0' }}>
                          Submitted by: <strong>{r.requester_name || r.requester_email}</strong>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button className="btn btn-primary btn-sm" style={{ fontSize: '0.82rem' }}
                            onClick={() => handleCorpAction(r.id, 'vc', stageEndpoint, 'approve')}>
                            ✓ Approve → Checker
                          </button>
                          <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.82rem', color: '#dc2626' }}
                            onClick={() => handleCorpReject(r.id, 'vc', stageEndpoint)}>
                            ✗ Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <h4 style={{ marginBottom: 8, color: '#334155' }}>DID Requests</h4>
                {didQueue.length === 0 ? (
                  <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: '#888' }}>No DID requests pending your review</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {didQueue.map((r: any) => (
                      <div key={r.id} className="card" style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <span style={{ fontWeight: 700 }}>🔑 DID Creation Request</span>
                            <span style={{ marginLeft: 8, fontSize: '0.72rem', background: '#e0e7ff', color: '#3730a3', padding: '2px 7px', borderRadius: 12 }}>From Requester</span>
                          </div>
                          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(r.created_at).toLocaleString()}</span>
                        </div>
                        {r.purpose && <div style={{ fontSize: '0.82rem', color: '#555', margin: '4px 0' }}>Purpose: {r.purpose}</div>}
                        <div style={{ fontSize: '0.8rem', color: '#64748b', margin: '4px 0' }}>
                          Submitted by: <strong>{r.requester_name || r.requester_email}</strong>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button className="btn btn-primary btn-sm" style={{ fontSize: '0.82rem' }}
                            onClick={() => handleCorpAction(r.id, 'did', 'maker-review', 'approve')}>
                            ✓ Approve → Checker
                          </button>
                          <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.82rem', color: '#dc2626' }}
                            onClick={() => handleCorpReject(r.id, 'did', 'maker-review')}>
                            ✗ Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Tab: Checker Approval Queue */}
          {tab === 'checker-queue' && (
            <div>
              <h3 style={{ marginBottom: 4 }}>Approval Queue <span style={{ fontSize: '0.8rem', background: '#dcfce7', color: '#14532d', padding: '2px 8px', borderRadius: 12, marginLeft: 8 }}>{corpQueue.length} pending</span></h3>
              <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '1rem' }}>
                Approve Maker-reviewed requests. Approved items move to Authorized Signatory for final sign-off.
              </p>
              <h4 style={{ marginBottom: 8, color: '#334155' }}>VC / Credential Requests</h4>
              {corpQueue.length === 0 ? (
                <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: '#888', marginBottom: '1rem' }}>No requests pending checker approval</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  {corpQueue.map((r: any) => (
                    <div key={r.id} className="card" style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <span style={{ fontWeight: 700 }}>{r.credential_type}</span>
                          <span style={{ marginLeft: 8, fontSize: '0.72rem', background: '#dcfce7', color: '#14532d', padding: '2px 7px', borderRadius: 12 }}>Maker Reviewed</span>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(r.created_at).toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b', margin: '4px 0' }}>
                        Requester: <strong>{r.requester_name || r.requester_email}</strong>
                        {r.corp_reviewer_name && <> · Reviewed by: <strong>{r.corp_reviewer_name}</strong></>}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button className="btn btn-primary btn-sm" style={{ fontSize: '0.82rem' }}
                          onClick={() => handleCorpAction(r.id, 'vc', 'checker-approve', 'approve')}>
                          ✓ Approve → Signatory
                        </button>
                        <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.82rem', color: '#dc2626' }}
                          onClick={() => handleCorpReject(r.id, 'vc', 'checker-approve')}>
                          ✗ Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <h4 style={{ marginBottom: 8, color: '#334155' }}>DID Requests</h4>
              {didQueue.length === 0 ? (
                <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: '#888' }}>No DID requests pending checker approval</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {didQueue.map((r: any) => (
                    <div key={r.id} className="card" style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={{ fontWeight: 700 }}>🔑 DID Creation Request</span>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(r.created_at).toLocaleString()}</span>
                      </div>
                      {r.purpose && <div style={{ fontSize: '0.82rem', color: '#555', margin: '4px 0' }}>Purpose: {r.purpose}</div>}
                      <div style={{ fontSize: '0.8rem', color: '#64748b', margin: '4px 0' }}>
                        Requester: <strong>{r.requester_name}</strong>
                        {r.corp_reviewer_name && <> · Maker: <strong>{r.corp_reviewer_name}</strong></>}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button className="btn btn-primary btn-sm" style={{ fontSize: '0.82rem' }}
                          onClick={() => handleCorpAction(r.id, 'did', 'checker-approve', 'approve')}>
                          ✓ Approve → Signatory
                        </button>
                        <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.82rem', color: '#dc2626' }}
                          onClick={() => handleCorpReject(r.id, 'did', 'checker-approve')}>
                          ✗ Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab: Authorized Signatory Queue */}
          {tab === 'signatory-queue' && (
            <div>
              <h3 style={{ marginBottom: 4 }}>Sign & Submit <span style={{ fontSize: '0.8rem', background: '#ede9fe', color: '#4c1d95', padding: '2px 8px', borderRadius: 12, marginLeft: 8 }}>{corpQueue.length} awaiting signature</span></h3>
              <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                Final corporate approval. Signing submits the request directly to the issuer (government authority).
              </p>
              <div className="card" style={{ background: '#fef3c7', border: '1px solid #f59e0b', padding: '0.6rem 1rem', marginBottom: '1rem', fontSize: '0.82rem', color: '#92400e' }}>
                ⚠️ <strong>Important:</strong> Approving will submit the request to the external issuer. This action cannot be undone.
              </div>
              <h4 style={{ marginBottom: 8, color: '#334155' }}>VC / Credential Requests</h4>
              {corpQueue.length === 0 ? (
                <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: '#888', marginBottom: '1rem' }}>No requests awaiting your signature</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  {corpQueue.map((r: any) => (
                    <div key={r.id} className="card" style={{ padding: '1rem', border: '2px solid #7c3aed20' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <span style={{ fontWeight: 700 }}>{r.credential_type}</span>
                          <span style={{ marginLeft: 8, fontSize: '0.72rem', background: '#ede9fe', color: '#4c1d95', padding: '2px 7px', borderRadius: 12 }}>Checker Approved</span>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(r.created_at).toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b', margin: '4px 0' }}>
                        Requester: <strong>{r.requester_name || r.requester_email}</strong>
                        {r.corp_reviewer_name && <> · Maker: <strong>{r.corp_reviewer_name}</strong></>}
                        {r.corp_checker_name && <> · Checker: <strong>{r.corp_checker_name}</strong></>}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button className="btn btn-primary btn-sm" style={{ fontSize: '0.82rem', background: '#7c3aed', borderColor: '#7c3aed' }}
                          onClick={() => handleCorpAction(r.id, 'vc', 'signatory-approve', 'approve')}>
                          ✍️ Sign & Submit to Issuer
                        </button>
                        <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.82rem', color: '#dc2626' }}
                          onClick={() => handleCorpReject(r.id, 'vc', 'signatory-approve')}>
                          ✗ Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <h4 style={{ marginBottom: 8, color: '#334155' }}>DID Requests</h4>
              {didQueue.length === 0 ? (
                <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: '#888' }}>No DID requests awaiting your signature</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {didQueue.map((r: any) => (
                    <div key={r.id} className="card" style={{ padding: '1rem', border: '2px solid #7c3aed20' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={{ fontWeight: 700 }}>🔑 DID Creation Request</span>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(r.created_at).toLocaleString()}</span>
                      </div>
                      {r.purpose && <div style={{ fontSize: '0.82rem', color: '#555', margin: '4px 0' }}>Purpose: {r.purpose}</div>}
                      <div style={{ fontSize: '0.8rem', color: '#64748b', margin: '4px 0' }}>
                        Requester: <strong>{r.requester_name}</strong>
                        {r.corp_checker_name && <> · Checker: <strong>{r.corp_checker_name}</strong></>}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button className="btn btn-primary btn-sm" style={{ fontSize: '0.82rem', background: '#7c3aed', borderColor: '#7c3aed' }}
                          onClick={() => handleCorpAction(r.id, 'did', 'signatory-approve', 'approve')}>
                          ✍️ Sign & Create DID
                        </button>
                        <button className="btn btn-secondary btn-sm" style={{ fontSize: '0.82rem', color: '#dc2626' }}
                          onClick={() => handleCorpReject(r.id, 'did', 'signatory-approve')}>
                          ✗ Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab: DID Issued — Authorized Signatory sees DIDs and shares to super_admin */}
          {tab === 'did-issued' && (
            <div>
              <div style={{ marginBottom: '1.25rem' }}>
                <h3 style={{ margin: 0, color: '#7c3aed' }}>🔑 Issued DIDs</h3>
                <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                  DIDs issued by the government authority for requests you approved. Review and share each with the Corporate Super Admin.
                </p>
              </div>

              {didNotifications.length === 0 ? (
                <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔑</div>
                  <div style={{ color: '#888' }}>No issued DIDs yet. They will appear here once the DID authority processes requests you approved.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {didNotifications.map((d: any) => {
                    const shared = !!d.as_shared_to_admin_at;
                    return (
                      <div key={d.id} className="card" style={{ border: shared ? '1px solid #bbf7d0' : '1px solid #e9d5ff', background: shared ? '#f0fdf4' : '#faf5ff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                          <div style={{ fontWeight: 700, color: '#0f172a' }}>🏢 {d.org_name}</div>
                          <span style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700,
                            background: shared ? '#dcfce7' : '#fef9c3', color: shared ? '#166534' : '#92400e' }}>
                            {shared ? '✓ Shared to Admin' : '⏳ Pending Share'}
                          </span>
                        </div>

                        <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#1e40af', background: '#eff6ff', borderRadius: 6, padding: '0.6rem 0.75rem', marginBottom: '0.6rem', wordBreak: 'break-all' as const }}>
                          {d.did_string || '(DID string not available)'}
                        </div>

                        {d.purpose && <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.4rem' }}>Purpose: {d.purpose}</div>}

                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: shared ? 0 : '0.75rem' }}>
                          Issued: {new Date(d.updated_at).toLocaleString()}
                          {shared && <span> · Shared: {new Date(d.as_shared_to_admin_at).toLocaleString()}</span>}
                        </div>

                        {!shared && (
                          <button
                            className="btn btn-primary"
                            style={{ background: '#7c3aed', borderColor: '#7c3aed', width: '100%', marginTop: '0.25rem' }}
                            onClick={async () => {
                              try {
                                const r = await fetch(`/api/corporate/signatory/issued-dids/${d.id}/share`, {
                                  method: 'POST',
                                  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                                  body: '{}',
                                });
                                const resp = await r.json();
                                if (!r.ok) throw new Error(resp.error);
                                showMsg('success', '✓ DID shared to Corporate Super Admin');
                                loadAll();
                              } catch (e: any) { showMsg('error', e.message); }
                            }}>
                            📤 Share to Corporate Super Admin
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* VP Review Tab — Employee 2 reviews VPs shared by colleague */}
          {tab === 'vp-review' && (
            <div>
              <h3 style={{ marginBottom: '0.25rem' }}>VP Peer Review Queue</h3>
              <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
                Presentations shared to you by a colleague for internal approval before submission to the verifier.
              </p>
              {vpReviewQueue.length === 0 ? (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
                  No presentations pending your review.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 700 }}>
                  {vpReviewQueue.map((pres: any) => {
                    const vp = typeof pres.vp_json === 'string' ? JSON.parse(pres.vp_json) : pres.vp_json;
                    const vcs: any[] = vp?.verifiableCredential || [];
                    return (
                      <div key={pres.id} className="card" style={{ padding: '1.25rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                          <div>
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>
                              VP from {pres.sender_name || pres.sender_email}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                              {new Date(pres.created_at).toLocaleString()}
                            </div>
                            {pres.reviewer_note && (
                              <div style={{ fontSize: '0.85rem', color: '#555', marginTop: 4, fontStyle: 'italic' }}>
                                Note: {pres.reviewer_note}
                              </div>
                            )}
                            {pres.required_credential_types && (
                              <div style={{ fontSize: '0.8rem', color: '#555', marginTop: 4 }}>
                                Verifier requires: <strong>{(pres.required_credential_types || []).join(', ')}</strong>
                              </div>
                            )}
                          </div>
                          <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: '0.75rem', background: '#fef9c3', color: '#854d0e', whiteSpace: 'nowrap' }}>
                            Pending Review
                          </span>
                        </div>

                        {/* Credentials inside the VP */}
                        <div style={{ background: '#f8fafc', borderRadius: 8, padding: '0.75rem', marginBottom: '0.75rem' }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.4rem' }}>
                            Credentials in this VP ({vcs.length})
                          </div>
                          {vcs.map((vc: any, i: number) => (
                            <div key={i} style={{ fontSize: '0.8rem', padding: '4px 0', borderBottom: i < vcs.length - 1 ? '1px solid #e2e8f0' : 'none' }}>
                              <strong>{vc.type?.find((t: string) => t !== 'VerifiableCredential') || vc.type?.[0]}</strong>
                              {vc.credentialSubject && (
                                <span style={{ color: '#64748b', marginLeft: 8 }}>
                                  — {Object.entries(vc.credentialSubject)
                                    .filter(([k]) => k !== 'id')
                                    .slice(0, 2)
                                    .map(([k, v]) => `${k}: ${v}`)
                                    .join(', ')}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            className="btn btn-primary"
                            style={{ fontSize: '0.85rem' }}
                            onClick={async () => {
                              const r = await fetch(`/api/presentations/${pres.id}/peer-approve`, {
                                method: 'POST',
                                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ decision: 'approve' }),
                              });
                              const d = await r.json();
                              if (r.ok) { showMsg('success', '✓ VP approved and submitted to verifier'); loadAll(); }
                              else showMsg('error', d.error);
                            }}
                          >
                            ✓ Approve &amp; Submit to Verifier
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.85rem', color: '#dc3545' }}
                            onClick={async () => {
                              const note = window.prompt('Rejection reason (optional):');
                              if (note === null) return;
                              const r = await fetch(`/api/presentations/${pres.id}/peer-approve`, {
                                method: 'POST',
                                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                                body: JSON.stringify({ decision: 'reject', note }),
                              });
                              const d = await r.json();
                              if (r.ok) { showMsg('success', 'VP rejected — colleague can recompose'); loadAll(); }
                              else showMsg('error', d.error);
                            }}
                          >
                            ✗ Reject
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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

      {/* Employee Account Created Modal */}
      {empAccountModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: 420, padding: '2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔑</div>
            <h3 style={{ marginBottom: '0.5rem' }}>Employee Portal Access Created</h3>
            <p style={{ color: '#555', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
              Share these credentials with the employee. They can log in and respond to proof requests.
            </p>
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: '1rem', marginBottom: '1.25rem', textAlign: 'left' }}>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 4 }}>Email</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 600, marginBottom: 12 }}>{empAccountModal.email}</div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 4 }}>Temporary Password</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1.1rem', letterSpacing: 1 }}>{empAccountModal.password}</div>
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setEmpAccountModal(null)}>Done</button>
          </div>
        </div>
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

      {/* Ledger Modal */}
      {ledgerCredId && (
        <LedgerModal
          credentialId={ledgerCredId}
          credentialType={credentials.find((c: any) => c.id === ledgerCredId)?.credential_type}
          token={token || ''}
          onClose={() => setLedgerCredId(null)}
        />
      )}
    </div>
  );
}
