import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAppShell } from '../components/AppShell';
import BlockchainBadge from '../components/BlockchainBadge';
import LedgerModal from '../components/LedgerModal';

type VCRequest = {
  id: string;
  credential_type: string;
  status: string;
  requester_name: string;
  requester_email: string;
  created_at: string;
  request_data: any;
  mc_action_id?: string;
  mc_action_status?: string;
};

type MCAction = {
  id: string;
  resource_type: string;
  resource_id: string;
  status: string;
  credential_type: string;
  requester_name: string;
  requester_email: string;
  maker_name: string;
  maker_email: string;
  created_at: string;
};

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

export default function AuthorityDashboard() {
  const { token, user } = useAuth();
  const { activeTab: view, setActiveTab: setView } = useAppShell();
  const subRole: string = (user as any)?.sub_role || '';

  const [vcRequests, setVcRequests] = useState<VCRequest[]>([]);
  const [mcQueue, setMcQueue] = useState<MCAction[]>([]);
  const [issued, setIssued] = useState<VCRequest[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [didRequests, setDidRequests] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', sub_role: 'maker' });
  const [tempPassword, setTempPassword] = useState('');

  // Checker reject inline
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Success modal
  const [successCredential, setSuccessCredential] = useState<any>(null);
  const [successBesuTxHash, setSuccessBesuTxHash] = useState<string | undefined>(undefined);
  const [ledgerCredId, setLedgerCredId] = useState<string | null>(null);
  const [ledgerCredType, setLedgerCredType] = useState<string | undefined>(undefined);

  // Corp Applications (did_issuer_admin only)
  const [corpApps, setCorpApps] = useState<any[]>([]);
  const [corpAppMsg, setCorpAppMsg] = useState('');
  const [selectedVcTypes, setSelectedVcTypes] = useState<Record<string, string[]>>({});

  const authHeader = () => ({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' });

  useEffect(() => {
    if (view === 'dashboard') { loadVcRequests(); loadIssued(); loadTeam(); loadDidRequests(); }
    if (view === 'vc-requests') loadVcRequests();
    if (view === 'did-requests') loadDidRequests();
    if (view === 'checker-queue') loadMCQueue();
    if (view === 'issued') loadIssued();
    if (view === 'team') loadTeam();
    if (view === 'corp-applications' || view === 'did-applications') loadCorpApplications();
  }, [view]);

  async function loadVcRequests() {
    try {
      const res = await fetch('/api/vc-requests/pending', { headers: authHeader() });
      const data = await res.json();
      setVcRequests(data.requests || []);
    } catch { setMsg('Failed to load VC requests'); }
  }

  async function loadMCQueue() {
    try {
      const res = await fetch('/api/mc/queue', { headers: authHeader() });
      const data = await res.json();
      setMcQueue(data.actions || []);
    } catch { setMsg('Failed to load checker queue'); }
  }

  async function loadIssued() {
    try {
      const res = await fetch('/api/vc-requests/issued', { headers: authHeader() });
      const data = await res.json();
      setIssued(data.requests || []);
    } catch { setMsg('Failed to load issued credentials'); }
  }

  async function loadTeam() {
    try {
      const res = await fetch('/api/authority/team', { headers: authHeader() });
      const data = await res.json();
      setTeam(data.team || []);
    } catch { setMsg('Failed to load team'); }
  }

  async function loadCorpApplications() {
    try {
      const res = await fetch('/api/did-issuer/corporate-applications', { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCorpApps(data.applications || []);
      // Pre-select all vc_types from each application's documents
      const preSelected: Record<string, string[]> = {};
      for (const app of (data.applications || [])) {
        preSelected[app.id] = (app.documents || []).map((d: any) => d.vc_type);
      }
      setSelectedVcTypes(preSelected);
    } catch (e: any) { setCorpAppMsg(e.message); }
  }

  async function handleIssueCorpDID(appId: string) {
    const vcTypes = selectedVcTypes[appId] || [];
    if (vcTypes.length === 0) { setCorpAppMsg('Select at least one VC type'); return; }
    setLoading(true);
    setCorpAppMsg('');
    try {
      const res = await fetch(`/api/did-issuer/corporate-applications/${appId}/issue`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ vc_types: vcTypes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCorpAppMsg(`✅ Issued! DID: ${data.corporateDid} | super_admin pass: ${data.super_admin_temp_password} | requester pass: ${data.requester_temp_password}`);
      loadCorpApplications();
    } catch (e: any) { setCorpAppMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleMakerReview(appId: string) {
    setLoading(true);
    setCorpAppMsg('');
    try {
      const res = await fetch(`/api/did-issuer/corporate-applications/${appId}/maker-review`, {
        method: 'POST',
        headers: authHeader(),
        body: '{}',
      });
      let data: any = {};
      try { data = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) throw new Error(data.error || 'Maker review failed');
      setCorpAppMsg('✅ Sent to checker.');
      loadCorpApplications();
    } catch (e: any) { setCorpAppMsg(e.message); }
    finally { setLoading(false); }
  }

  async function loadDidRequests() {
    try {
      const res = await fetch('/api/authority/did-requests', { headers: authHeader() });
      const data = await res.json();
      setDidRequests(data.requests || []);
    } catch { setMsg('Failed to load DID requests'); }
  }

  async function handleDIDApprove(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/authority/did-requests/${id}/approve`, {
        method: 'POST', headers: authHeader(), body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg(data.queued ? 'Forwarded to checker queue.' : `DID issued: ${data.did}`);
      loadDidRequests();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleDIDIssue(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/authority/did-requests/${id}/issue`, {
        method: 'POST', headers: authHeader(), body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg(`DID issued successfully: ${data.did}`);
      loadDidRequests();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleDIDReject(id: string) {
    const reason = window.prompt('Rejection reason:');
    if (reason === null) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/authority/did-requests/${id}/reject`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ reason: reason || 'Rejected by issuer' }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setMsg('DID request rejected.');
      loadDidRequests();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleApproveRequest(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/vc-requests/${id}/approve`, {
        method: 'POST', headers: authHeader(), body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.queued) {
        setMsg('Forwarded to Checker queue successfully.');
      } else {
        setSuccessCredential(data.credential);
        setSuccessBesuTxHash(data.besuTxHash);
      }
      loadVcRequests();
      loadIssued();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleRejectRequest(id: string, reason: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/vc-requests/${id}/reject`, {
        method: 'POST', headers: authHeader(), body: JSON.stringify({ reason }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setMsg('Request rejected.');
      loadVcRequests();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleMCApprove(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/mc/${id}/approve`, {
        method: 'POST', headers: authHeader(), body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccessCredential(data.credential);
      setSuccessBesuTxHash(data.besuTxHash);
      loadMCQueue();
      loadIssued();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleMCReject(id: string, reason: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/mc/${id}/reject`, {
        method: 'POST', headers: authHeader(), body: JSON.stringify({ reason }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setMsg('Action rejected.');
      setRejectTarget(null);
      setRejectReason('');
      loadMCQueue();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/authority/team/invite', {
        method: 'POST', headers: authHeader(), body: JSON.stringify(inviteForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTempPassword(data.tempPassword);
      setShowInvite(false);
      setInviteForm({ email: '', name: '', sub_role: 'maker' });
      loadTeam();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  const statusBadge = (status: string) => {
    const styles: Record<string, { bg: string; color: string }> = {
      pending:  { bg: '#fff3cd', color: '#856404' },
      approved: { bg: '#d4edda', color: '#155724' },
      rejected: { bg: '#f8d7da', color: '#721c24' },
    };
    const s = styles[status] || styles.pending;
    return (
      <span style={{ background: s.bg, color: s.color, padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const thStyle: React.CSSProperties = { padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: '#555', borderBottom: '1px solid #e2e8f0', background: '#f8f9fa' };
  const tdStyle: React.CSSProperties = { padding: '0.75rem 1rem', borderBottom: '1px solid #f0f0f0' };

  return (
    <>
    <div style={{ padding: '2rem' }}>
      {msg && (
        <div className={`alert ${msg.includes('success') || msg.includes('Forwarded') ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: '1rem' }}>
          {msg}
          <button onClick={() => setMsg('')} style={{ marginLeft: '1rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* ── Overview ── */}
      {view === 'dashboard' && (
        <>
          <h2 style={{ marginBottom: '1.5rem' }}>Overview</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
            {[
              { label: 'Pending VC Requests', value: vcRequests.length, color: '#f59e0b', tab: 'vc-requests' },
              { label: 'Pending DID Requests', value: didRequests.filter(r => r.status === 'pending').length, color: '#7c3aed', tab: 'did-requests' },
              { label: 'Issued Credentials', value: issued.length, color: '#1a56db', tab: 'issued' },
              { label: 'Team Members', value: team.length, color: '#10b981', tab: 'team' },
            ].map(s => (
              <div key={s.label} className="card" onClick={() => setView(s.tab)}
                style={{ padding: '1.25rem', textAlign: 'center', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ color: '#666', fontSize: '0.875rem', marginTop: '0.25rem' }}>{s.label}</div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.5rem' }}>Click to view →</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="card" style={{ padding: '1.25rem' }}>
              <h4 style={{ marginBottom: '0.75rem' }}>Profile Information</h4>
              <p><strong>Name:</strong> {user?.name}</p>
              <p><strong>Email:</strong> {user?.email}</p>
              <p><strong>Role:</strong> Government Agency</p>
              {subRole && <p><strong>Sub Role:</strong> <span style={{ ...SUB_ROLE_BADGE[subRole], padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600, ...{ display: 'inline-block' } }}>{subRole}</span></p>}
            </div>
            <div className="card" style={{ padding: '1.25rem' }}>
              <h4 style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between' }}>
                Recent VC Requests
                <button onClick={() => setView('vc-requests')} style={{ background: 'none', border: 'none', color: '#1a56db', fontSize: '0.75rem', cursor: 'pointer' }}>View all →</button>
              </h4>
              {vcRequests.length === 0
                ? <p style={{ color: '#888', fontSize: '0.85rem' }}>No pending requests</p>
                : vcRequests.slice(0, 3).map(r => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px solid #f0f0f0', fontSize: '0.82rem' }}>
                    <span style={{ fontWeight: 500 }}>{r.credential_type}</span>
                    <span style={{ color: '#888' }}>{r.requester_name}</span>
                  </div>
                ))
              }
              {vcRequests.length > 3 && (
                <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.5rem' }}>+{vcRequests.length - 3} more</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── VC Requests ── */}
      {view === 'vc-requests' && (
        <>
          <h2 style={{ marginBottom: '1rem' }}>VC Requests</h2>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Requester', 'Credential Type', 'Date', 'Status', 'Actions'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vcRequests.length === 0 && (
                  <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#888' }}>No pending VC requests</td></tr>
                )}
                {vcRequests.map(req => (
                  <tr key={req.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{req.requester_name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#888' }}>{req.requester_email}</div>
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{req.credential_type}</td>
                    <td style={{ ...tdStyle, color: '#888', fontSize: '0.85rem' }}>{new Date(req.created_at).toLocaleDateString()}</td>
                    <td style={tdStyle}>
                      {req.mc_action_id && req.mc_action_status === 'pending'
                        ? <span style={{ background: '#dbeafe', color: '#1e40af', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>In Checker Queue</span>
                        : statusBadge(req.status)}
                    </td>
                    <td style={{ ...tdStyle, display: 'flex', gap: '0.5rem' }}>
                      {(subRole === 'super_admin' || !subRole) && !req.mc_action_id && (
                        <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                          disabled={loading} onClick={() => handleApproveRequest(req.id)}>
                          Approve &amp; Issue
                        </button>
                      )}
                      {subRole === 'maker' && (
                        <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                          disabled={loading || !!(req.mc_action_id && req.mc_action_status === 'pending')}
                          onClick={() => handleApproveRequest(req.id)}>
                          {req.mc_action_id && req.mc_action_status === 'pending' ? 'Forwarded ✓' : 'Forward to Checker'}
                        </button>
                      )}
                      {(subRole === 'super_admin' || subRole === 'maker' || !subRole) && !req.mc_action_id && (
                        <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', color: '#dc3545' }}
                          onClick={() => {
                            const reason = window.prompt('Rejection reason:');
                            if (reason) handleRejectRequest(req.id, reason);
                          }}>
                          Reject
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── DID Requests ── */}
      {view === 'did-requests' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>DID Requests</h2>
            <span style={{ fontSize: '0.8rem', color: '#64748b', background: '#f1f5f9', padding: '4px 12px', borderRadius: 20 }}>
              {didRequests.filter(r => r.status === 'pending').length} pending
            </span>
          </div>

          {didRequests.length === 0 ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔑</div>
              <p>No DID requests received yet. Corporate entities submit DID requests through their internal approval flow.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {didRequests.map((dr: any) => {
                const rd = typeof dr.request_data === 'string' ? JSON.parse(dr.request_data || '{}') : (dr.request_data || {});
                const isPending = dr.status === 'pending';
                const statusColors: Record<string, { bg: string; color: string }> = {
                  pending:  { bg: '#fef3c7', color: '#92400e' },
                  approved: { bg: '#d1fae5', color: '#065f46' },
                  rejected: { bg: '#fee2e2', color: '#991b1b' },
                };
                const sc = statusColors[dr.status] || statusColors.pending;

                // Corp approval timeline
                const corpStages = [
                  { key: 'submitted',          label: 'Submitted',         icon: '📋' },
                  { key: 'maker_reviewed',      label: 'Maker Reviewed',    icon: '🔍' },
                  { key: 'checker_approved',    label: 'Checker Approved',  icon: '✅' },
                  { key: 'signatory_approved',  label: 'Signatory Signed',  icon: '✍️' },
                ];
                const stageOrder = ['submitted', 'maker_reviewed', 'checker_approved', 'signatory_approved'];
                const corpIdx = stageOrder.indexOf(dr.corp_status);

                return (
                  <div key={dr.id} className="card" style={{ padding: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '1rem' }}>{rd.orgName || dr.org_name || 'Unknown Organisation'}</div>
                        <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>
                          {rd.entityType && <span style={{ marginRight: 12 }}>{rd.entityType}</span>}
                          {rd.cin && <span style={{ fontFamily: 'monospace' }}>CIN: {rd.cin}</span>}
                        </div>
                      </div>
                      <span style={{ ...sc, padding: '3px 12px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600 }}>
                        {dr.status.charAt(0).toUpperCase() + dr.status.slice(1)}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.82rem' }}>
                      <div><span style={{ color: '#64748b' }}>Purpose:</span> <strong>{dr.purpose || '—'}</strong></div>
                      <div><span style={{ color: '#64748b' }}>Requested by:</span> <strong>{dr.requester_name}</strong></div>
                      <div><span style={{ color: '#64748b' }}>Date:</span> {new Date(dr.created_at).toLocaleDateString()}</div>
                      {rd.contactPerson && <div><span style={{ color: '#64748b' }}>Contact:</span> {rd.contactPerson}</div>}
                      {rd.contactEmail && <div><span style={{ color: '#64748b' }}>Email:</span> {rd.contactEmail}</div>}
                    </div>

                    {/* Corporate approval chain */}
                    <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                      {corpStages.map((stage, i) => {
                        const done = i <= corpIdx;
                        return (
                          <span key={stage.key} style={{
                            padding: '2px 8px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 600,
                            background: done ? '#d1fae5' : '#f1f5f9',
                            color: done ? '#065f46' : '#94a3b8',
                          }}>
                            {stage.icon} {stage.label}
                          </span>
                        );
                      })}
                      <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: '0.7rem', fontWeight: 600,
                        background: dr.status === 'approved' ? '#d1fae5' : isPending ? '#fef3c7' : '#f1f5f9',
                        color: dr.status === 'approved' ? '#065f46' : isPending ? '#92400e' : '#94a3b8',
                      }}>
                        🏛 IBDIC Issues DID
                      </span>
                    </div>

                    {rd.additionalNotes && (
                      <div style={{ fontSize: '0.8rem', color: '#64748b', background: '#f8fafc', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.75rem' }}>
                        <strong>Notes:</strong> {rd.additionalNotes}
                      </div>
                    )}

                    {dr.status === 'approved' && dr.created_did_string && (
                      <div style={{ background: '#d1fae5', border: '1px solid #a7f3d0', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
                        <strong>DID Issued:</strong>{' '}
                        <code style={{ fontFamily: 'monospace' }}>{dr.created_did_string}</code>
                      </div>
                    )}

                    {dr.rejection_reason && (
                      <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
                        <strong>Rejection Reason:</strong> {dr.rejection_reason}
                      </div>
                    )}

                    {isPending && (
                      <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #f0f0f0' }}>
                        {(subRole === 'super_admin' || !subRole) && (
                          <button className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '0.3rem 0.9rem' }}
                            disabled={loading} onClick={() => handleDIDApprove(dr.id)}>
                            Approve &amp; Issue DID
                          </button>
                        )}
                        {subRole === 'maker' && (
                          <button className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '0.3rem 0.9rem' }}
                            disabled={loading} onClick={() => handleDIDApprove(dr.id)}>
                            Forward to Checker
                          </button>
                        )}
                        {subRole === 'checker' && (
                          <button className="btn btn-primary" style={{ fontSize: '0.85rem', padding: '0.3rem 0.9rem' }}
                            disabled={loading} onClick={() => handleDIDIssue(dr.id)}>
                            ✓ Issue DID
                          </button>
                        )}
                        <button className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '0.3rem 0.9rem', color: '#dc2626' }}
                          disabled={loading} onClick={() => handleDIDReject(dr.id)}>
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Checker Queue ── */}
      {view === 'checker-queue' && (
        <>
          <h2 style={{ marginBottom: '1rem' }}>Checker Queue</h2>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Credential Type', 'Requester', 'Forwarded By', 'Date', 'Actions'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mcQueue.length === 0 && (
                  <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#888' }}>No pending actions in the queue.</td></tr>
                )}
                {mcQueue.map((action: MCAction) => (
                  <React.Fragment key={action.id}>
                    <tr>
                      <td style={{ ...tdStyle, fontWeight: 500 }}>{action.credential_type || action.resource_type}</td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{action.requester_name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#888' }}>{action.requester_email}</div>
                      </td>
                      <td style={tdStyle}>
                        <div>{action.maker_name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#888' }}>{action.maker_email}</div>
                      </td>
                      <td style={{ ...tdStyle, color: '#888', fontSize: '0.85rem' }}>{new Date(action.created_at).toLocaleDateString()}</td>
                      <td style={{ ...tdStyle }}>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                            disabled={loading} onClick={() => handleMCApprove(action.id)}>
                            Approve
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', color: '#dc3545' }}
                            onClick={() => { setRejectTarget(action.id); setRejectReason(''); }}>
                            Reject
                          </button>
                        </div>
                        {rejectTarget === action.id && (
                          <div style={{ marginTop: '0.5rem' }}>
                            <input className="form-control" placeholder="Rejection reason..." value={rejectReason}
                              onChange={e => setRejectReason(e.target.value)}
                              style={{ marginBottom: '0.25rem', fontSize: '0.85rem', padding: '0.25rem 0.5rem' }} />
                            <button className="btn btn-danger" style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem' }}
                              disabled={!rejectReason.trim() || loading}
                              onClick={() => handleMCReject(action.id, rejectReason)}>
                              Confirm
                            </button>
                            <button onClick={() => setRejectTarget(null)}
                              style={{ marginLeft: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', color: '#888' }}>
                              Cancel
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Issued ── */}
      {view === 'issued' && (
        <>
          <h2 style={{ marginBottom: '1rem' }}>Issued Credentials</h2>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Requester', 'Credential Type', 'Status', 'Blockchain', 'Date', ''].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {issued.length === 0 && (
                  <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#888' }}>No issued credentials yet.</td></tr>
                )}
                {issued.map((req: any) => (
                  <tr key={req.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{req.requester_name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#888' }}>{req.requester_email}</div>
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 500 }}>{req.credential_type}</td>
                    <td style={tdStyle}>{statusBadge(req.status)}</td>
                    <td style={tdStyle}>
                      <BlockchainBadge compact txHash={req.polygon_tx_hash} blockNumber={req.polygon_block_number} />
                    </td>
                    <td style={{ ...tdStyle, color: '#888', fontSize: '0.85rem' }}>{new Date(req.created_at).toLocaleDateString()}</td>
                    <td style={tdStyle}>
                      {req.credential_id && (
                        <button
                          className="btn btn-sm"
                          style={{ background: '#1a56db', color: '#fff', border: 'none', whiteSpace: 'nowrap' }}
                          onClick={() => { setLedgerCredId(req.credential_id); setLedgerCredType(req.credential_type); }}
                        >
                          ⛓ Ledger
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Team ── */}
      {view === 'team' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>Team</h2>
            <button className="btn btn-primary" onClick={() => setShowInvite(true)}>+ Invite Member</button>
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
        </>
      )}

      {/* ── DID Applications (role-aware: maker / checker / super_admin) ── */}
      {(view === 'corp-applications' || view === 'did-applications') && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: 0 }}>
              {subRole === 'maker' ? 'DID Applications — Awaiting Review' : 'DID Applications — Ready to Issue'}
            </h2>
          </div>

          {corpAppMsg && (
            <div style={{
              padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: '0.85rem',
              background: corpAppMsg.startsWith('✅') ? '#f0fdf4' : '#fef2f2',
              color: corpAppMsg.startsWith('✅') ? '#166534' : '#dc2626',
              border: `1px solid ${corpAppMsg.startsWith('✅') ? '#bbf7d0' : '#fecaca'}`,
              wordBreak: 'break-all',
            }}>
              {corpAppMsg}
            </div>
          )}

          {corpApps.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>
              {subRole === 'maker' ? 'No applications awaiting maker review.' : 'No applications ready to issue.'}
            </div>
          )}

          {corpApps.map(app => {
            const docs: any[] = app.documents || [];
            const slug = (app.company_name || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
            const didPreview = `did:web:didvc.platform:${slug}`;
            const myVcTypes = selectedVcTypes[app.id] || [];

            return (
              <div key={app.id} className="card" style={{ marginBottom: '1.5rem', padding: '1.5rem', border: `2px solid ${subRole === 'maker' ? '#f59e0b' : '#2563eb'}` }}>
                <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#1e293b', marginBottom: '0.25rem' }}>{app.company_name}</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.25rem' }}>
                  CIN: {app.cin} · Signatory: {app.signatory_name || '—'}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.75rem' }}>
                  Submitted: {app.created_at ? new Date(app.created_at).toLocaleDateString() : '—'}
                  {subRole !== 'maker' && app.maker_name && <span> · Reviewed by: {app.maker_name}</span>}
                </div>

                {/* Documents */}
                <div style={{ background: 'white', borderRadius: 6, padding: '0.75rem', marginBottom: '0.75rem', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#374151', marginBottom: '0.5rem' }}>
                    {subRole === 'maker' ? 'Documents' : 'VCs to issue against documents'}
                  </div>
                  {docs.length === 0 && <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No documents</span>}
                  {docs.map((doc: any, i: number) => (
                    subRole === 'maker' ? (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0.75rem', borderRadius: 4, marginBottom: '0.35rem', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#1e293b' }}>{doc.vc_type}</div>
                          <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                            {doc.file_path
                              ? <a href={`/${doc.file_path}`} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none' }}>📄 {doc.file_path.split('/').pop()}</a>
                              : `📋 Ref: ${doc.reference_number}`}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <label key={i} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '0.4rem 0.75rem', borderRadius: 4, marginBottom: '0.35rem', cursor: 'pointer',
                        background: myVcTypes.includes(doc.vc_type) ? '#f0fdf4' : '#f8fafc',
                        borderLeft: `3px solid ${myVcTypes.includes(doc.vc_type) ? '#16a34a' : '#e2e8f0'}`,
                      }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#1e293b' }}>{doc.vc_type}</div>
                          <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                            {doc.file_path ? `📄 ${doc.file_path.split('/').pop()}` : `📋 Ref: ${doc.reference_number}`}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={myVcTypes.includes(doc.vc_type)}
                          onChange={() => setSelectedVcTypes(prev => {
                            const current = prev[app.id] || [];
                            return {
                              ...prev,
                              [app.id]: current.includes(doc.vc_type)
                                ? current.filter(t => t !== doc.vc_type)
                                : [...current, doc.vc_type],
                            };
                          })}
                          style={{ accentColor: '#16a34a', width: 16, height: 16 }}
                        />
                      </label>
                    )
                  ))}
                </div>

                {/* DID Preview (checker/super_admin only) */}
                {subRole !== 'maker' && (
                  <div style={{ background: 'white', borderRadius: 6, padding: '0.6rem 0.9rem', marginBottom: '0.75rem', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#374151', marginBottom: '0.25rem' }}>DID to be issued</div>
                    <code style={{ fontSize: '0.72rem', color: '#2563eb', wordBreak: 'break-all' }}>{didPreview}</code>
                  </div>
                )}

                {/* Warning (checker/super_admin only) */}
                {subRole !== 'maker' && (
                  <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '0.6rem 0.75rem', marginBottom: '1rem', fontSize: '0.75rem', color: '#92400e' }}>
                    ⚡ Clicking "Issue" will: create the corporate DID · create super_admin + requester accounts · issue selected VCs to corporate wallet · log temp passwords to server console
                  </div>
                )}

                {/* Action button */}
                {subRole === 'maker' ? (
                  <button
                    style={{ width: '100%', padding: '0.75rem', background: loading ? '#94a3b8' : '#f59e0b', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.95rem', cursor: loading ? 'default' : 'pointer' }}
                    disabled={loading}
                    onClick={() => handleMakerReview(app.id)}
                  >
                    Send to Checker →
                  </button>
                ) : (
                  <button
                    style={{ width: '100%', padding: '0.75rem', background: loading ? '#94a3b8' : '#16a34a', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.95rem', cursor: loading ? 'default' : 'pointer' }}
                    disabled={loading}
                    onClick={() => handleIssueCorpDID(app.id)}
                  >
                    🔑 Issue DID + Credentials →
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>

    {/* ── Success / Issued VC Modal ── */}
    {successCredential && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
        <div className="card" style={{ width: 460, padding: '2.5rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>✅</div>
          <h2 style={{ color: '#28a745', marginBottom: '1rem' }}>Credential Issued!</h2>
          <div style={{ textAlign: 'left', background: '#f8f9fa', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem' }}>
            <p style={{ margin: '0.25rem 0' }}><strong>Type:</strong> {successCredential.type?.slice(-1)[0] || successCredential['@type']?.slice(-1)[0] || 'VerifiableCredential'}</p>
            <p style={{ margin: '0.25rem 0' }}><strong>Issued to:</strong> {successCredential.credentialSubject?.id}</p>
            <p style={{ margin: '0.25rem 0', fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}><strong>ID:</strong> {successCredential.id}</p>
            {successBesuTxHash && (
              <div style={{ marginTop: '0.75rem' }}>
                <BlockchainBadge txHash={successBesuTxHash} />
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => { setSuccessCredential(null); setSuccessBesuTxHash(undefined); }}>Done</button>
        </div>
      </div>
    )}

    {/* ── Temp Password Modal ── */}
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
    {/* ── Ledger Modal ── */}
    {ledgerCredId && (
      <LedgerModal
        credentialId={ledgerCredId}
        credentialType={ledgerCredType}
        token={token || ''}
        onClose={() => { setLedgerCredId(null); setLedgerCredType(undefined); }}
      />
    )}
    </>
  );
}
