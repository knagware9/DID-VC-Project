import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAppShell } from '../components/AppShell';

type Tab = 'overview' | 'authorities' | 'dids' | 'organizations' | 'entities' | 'entity-onboard' | 'admin-queue' | 'admin-team';

type Authority = {
  id: string; email: string; name: string;
  authority_type: string; sub_role: string; created_at: string;
};

type DIDRow = {
  id: string; did_string: string; did_type: string;
  owner_name: string; owner_role: string; created_at: string;
};

type OrgRow = {
  id: string; org_name: string; company_name: string; cin: string;
  application_status: string; authority_verifications: Record<string, any>; created_at: string;
};

type CorpApplication = {
  id: string; company_name: string; cin: string; pan_number: string; gstn: string;
  super_admin_name: string; super_admin_email: string;
  requester_name: string; requester_email: string;
  signatory_name: string; signatory_email: string; signatory_user_id: string;
  application_status: string; rejection_reason: string | null;
  state: string; date_of_incorporation: string; director_full_name: string; designation: string;
  created_at: string; super_admin_exists: string | null;
};

type Stats = {
  total_orgs: string; total_entities: string;
  approved_orgs: string; rejected_orgs: string;
};

type PlatformEntity = {
  id: string; name: string; email: string; entity_type: string;
  status: string; did: string | null; onboarded_by_name: string | null;
  activated_by_name: string | null; created_at: string;
};

type AdminAction = {
  id: string; resource_type: string; resource_id: string;
  maker_id: string; maker_name: string; maker_email: string;
  entity_name: string; entity_type: string; entity_email: string;
  status: string; created_at: string;
};

type TeamMember = {
  id: string; email: string; name: string; sub_role: string; created_at: string;
};

const AUTHORITY_TYPES = ['mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor'];
const AUTHORITY_SUB_ROLES = ['did_issuer_admin', 'vc_issuer_admin', 'maker', 'checker'];
const AUTHORITY_LABELS: Record<string, string> = {
  mca: 'MCA', dgft: 'DGFT', gstn_trust_anchor: 'GSTN', pan_trust_anchor: 'Income Tax',
};
const ENTITY_TYPE_LABELS: Record<string, string> = {
  did_issuer: 'DID Issuer', vc_issuer: 'VC Issuer', trust_endorser: 'Trust Endorser',
};
const STATUS_COLORS: Record<string, string> = {
  pending: '#ffc107', partial: '#17a2b8', complete: '#28a745', rejected: '#dc3545',
  active: '#28a745', inactive: '#6c757d',
};

export default function PortalManagerDashboard() {
  const { token, user } = useAuth();
  const { activeTab: tab, setActiveTab: setTab } = useAppShell();
  const [stats, setStats] = useState<Stats | null>(null);
  const [authorities, setAuthorities] = useState<Authority[]>([]);
  const [dids, setDids] = useState<DIDRow[]>([]);
  const [didPage, setDidPage] = useState(1);
  const [didTotal, setDidTotal] = useState(0);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orgStatusFilter, setOrgStatusFilter] = useState('');
  const [entities, setEntities] = useState<PlatformEntity[]>([]);
  const [adminQueue, setAdminQueue] = useState<AdminAction[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', name: '', authority_type: 'mca', sub_role: 'maker' });

  const [showOnboardForm, setShowOnboardForm] = useState(false);
  const [onboardForm, setOnboardForm] = useState({ name: '', email: '', entity_type: 'did_issuer', notes: '' });

  const [showTeamForm, setShowTeamForm] = useState(false);
  const [teamForm, setTeamForm] = useState({ email: '', name: '', sub_role: 'maker' });

  const [corpApplications, setCorpApplications] = useState<CorpApplication[]>([]);
  const [corpAppFilter, setCorpAppFilter] = useState('');
  const [corpViewApp, setCorpViewApp] = useState<CorpApplication | null>(null);
  const [corpApproveResult, setCorpApproveResult] = useState<{ superAdminTempPassword?: string; requesterTempPassword?: string; message?: string } | null>(null);
  const [corpRejectingId, setCorpRejectingId] = useState<string | null>(null);
  const [corpRejectReason, setCorpRejectReason] = useState('');

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [createdCred, setCreatedCred] = useState<{ email: string; tempPassword: string; did?: string; label?: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const authHeader = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  useEffect(() => { loadTab(); }, [tab, didPage, orgStatusFilter, corpAppFilter]);

  async function loadTab() {
    setLoading(true);
    try {
      if (tab === 'overview') {
        const r = await fetch('/api/portal/stats', { headers: authHeader() });
        const d = await r.json();
        setStats(d.stats);
      } else if (tab === 'authorities') {
        const r = await fetch('/api/portal/authorities', { headers: authHeader() });
        const d = await r.json();
        setAuthorities(d.authorities || []);
      } else if (tab === 'dids') {
        const r = await fetch(`/api/portal/dids?page=${didPage}`, { headers: authHeader() });
        const d = await r.json();
        setDids(d.dids || []);
        setDidTotal(d.total || 0);
      } else if (tab === 'organizations') {
        const qs = corpAppFilter ? `?status=${corpAppFilter}` : '';
        const r = await fetch(`/api/portal/corporate-applications${qs}`, { headers: authHeader() });
        const d = await r.json();
        setCorpApplications(d.applications || []);
      } else if (tab === 'entities') {
        const r = await fetch('/api/portal/entities', { headers: authHeader() });
        const d = await r.json();
        setEntities(d.entities || []);
      } else if (tab === 'admin-queue') {
        const r = await fetch('/api/mc/queue', { headers: authHeader() });
        const d = await r.json();
        setAdminQueue(d.actions || []);
      } else if (tab === 'admin-team') {
        const r = await fetch('/api/portal/admin/team', { headers: authHeader() });
        const d = await r.json();
        setTeamMembers(d.team || []);
      }
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleDeactivate(id: string, active: boolean) {
    const r = await fetch(`/api/portal/authorities/${id}`, {
      method: 'PATCH', headers: authHeader(),
      body: JSON.stringify({ active }),
    });
    if (r.ok) loadTab();
    else { const d = await r.json(); setMsg(d.error); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await fetch('/api/portal/authorities', {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify(createForm),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setCreatedCred({ email: createForm.email, tempPassword: d.tempPassword, label: 'Authority Account' });
      setShowCreateForm(false);
      setCreateForm({ email: '', name: '', authority_type: 'mca', sub_role: 'maker' });
      loadTab();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleOnboardSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await fetch('/api/portal/entities/submit', {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify(onboardForm),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMsg('');
      setShowOnboardForm(false);
      setOnboardForm({ name: '', email: '', entity_type: 'did_issuer', notes: '' });
      setTab('entities');
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleApprove(actionId: string) {
    setLoading(true);
    try {
      const r = await fetch(`/api/mc/${actionId}/approve`, {
        method: 'POST', headers: authHeader(), body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setCreatedCred({ email: d.did ? '' : '', tempPassword: d.tempPassword, did: d.did, label: 'Entity Activated' });
      loadTab();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleReject(actionId: string) {
    if (!rejectReason.trim()) { setMsg('Rejection reason is required'); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/mc/${actionId}/reject`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ reason: rejectReason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setRejectingId(null);
      setRejectReason('');
      loadTab();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleCorpApprove(id: string) {
    setLoading(true);
    try {
      const r = await fetch(`/api/portal/corporate-applications/${id}/approve`, {
        method: 'POST', headers: authHeader(), body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setCorpApproveResult({ superAdminTempPassword: d.superAdminTempPassword, requesterTempPassword: d.requesterTempPassword, message: d.message });
      setCorpViewApp(null);
      loadTab();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleCorpReject(id: string) {
    if (!corpRejectReason.trim()) { setMsg('Rejection reason is required'); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/portal/corporate-applications/${id}/reject`, {
        method: 'POST', headers: authHeader(), body: JSON.stringify({ reason: corpRejectReason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setCorpRejectingId(null);
      setCorpRejectReason('');
      setCorpViewApp(null);
      loadTab();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleAddTeamMember(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await fetch('/api/portal/admin/team', {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify(teamForm),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setCreatedCred({ email: teamForm.email, tempPassword: d.tempPassword, label: 'Team Member Account' });
      setShowTeamForm(false);
      setTeamForm({ email: '', name: '', sub_role: 'maker' });
      loadTab();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  const thStyle: React.CSSProperties = { padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: '#555', borderBottom: '1px solid #e2e8f0' };
  const tdStyle: React.CSSProperties = { padding: '0.75rem 1rem', fontSize: '0.875rem', borderBottom: '1px solid #f0f0f0' };

  function StatusBadge({ status }: { status: string }) {
    const color = STATUS_COLORS[status] || '#888';
    return (
      <span style={{ background: color + '22', color, padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, textTransform: 'capitalize' }}>
        {status}
      </span>
    );
  }

  return (
    <div style={{ padding: '2rem', overflow: 'auto' }}>
      {msg && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {msg}
          <button onClick={() => setMsg('')} style={{ marginLeft: '1rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Credential / result modal */}
      {createdCred && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: 440, padding: '2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔑</div>
            <h3 style={{ color: '#28a745', marginBottom: '1rem' }}>{createdCred.label || 'Account Created!'}</h3>
            <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '1rem', textAlign: 'left', marginBottom: '1.5rem' }}>
              {createdCred.email && <div style={{ marginBottom: '0.5rem' }}><strong>Email:</strong> {createdCred.email}</div>}
              <div style={{ marginBottom: createdCred.did ? '0.5rem' : 0 }}>
                <strong>Temp Password:</strong>{' '}
                <code style={{ background: '#e2e8f0', padding: '0.2rem 0.5rem', borderRadius: 4 }}>{createdCred.tempPassword}</code>
              </div>
              {createdCred.did && (
                <div style={{ marginTop: '0.5rem', wordBreak: 'break-all' }}>
                  <strong>DID:</strong>{' '}
                  <code style={{ fontSize: '0.75rem', color: '#444' }}>{createdCred.did}</code>
                </div>
              )}
            </div>
            <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Share these credentials securely. The user should change their password on first login.</p>
            <button className="btn btn-primary" onClick={() => setCreatedCred(null)}>Done</button>
          </div>
        </div>
      )}

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <>
          <h2 style={{ marginBottom: '1.5rem' }}>Platform Overview</h2>
          {stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
              {[
                { label: 'Corporate Members', value: stats.total_orgs, color: '#1a56db', icon: '🏢', tab: 'organizations' as Tab },
                { label: 'Issuer & Trusted Endorser', value: stats.total_entities, color: '#7c3aed', icon: '🌐', tab: 'entities' as Tab },
                { label: 'Approved Organizations', value: stats.approved_orgs, color: '#16a34a', icon: '✅', tab: 'organizations' as Tab },
                { label: 'Rejected Organizations', value: stats.rejected_orgs, color: '#dc2626', icon: '❌', tab: 'organizations' as Tab },
              ].map(s => (
                <div key={s.label} className="card" onClick={() => setTab(s.tab)}
                  style={{ padding: '1.5rem', textAlign: 'center', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}>
                  <div style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>{s.icon}</div>
                  <div style={{ fontSize: '2.25rem', fontWeight: 700, color: s.color }}>{s.value || '0'}</div>
                  <div style={{ color: '#555', fontSize: '0.85rem', marginTop: '0.4rem', fontWeight: 500 }}>{s.label}</div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.4rem' }}>Click to view →</div>
                </div>
              ))}
            </div>
          )}
          <div className="card" style={{ padding: '1.25rem' }}>
            <h4 style={{ marginBottom: '0.75rem' }}>Portal Manager Profile</h4>
            <p><strong>Name:</strong> {user?.name}</p>
            <p><strong>Email:</strong> {user?.email}</p>
            <p><strong>Role:</strong> Portal Manager <span style={{ color: '#1a56db', fontWeight: 600 }}>({user?.sub_role?.replace(/_/g, ' ')})</span></p>
            <p><strong>Status:</strong> <span style={{ color: '#28a745', fontWeight: 600 }}>Active</span></p>
          </div>
        </>
      )}

      {/* ── Issuer & Trusted Endorser ── */}
      {tab === 'entities' && (
        <>
          <h2 style={{ marginBottom: '1.5rem' }}>Issuer &amp; Trusted Endorser</h2>
          {loading ? <p style={{ color: '#888' }}>Loading...</p> : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    {['Name', 'Email', 'Type', 'Status', 'DID', 'Onboarded By', 'Created'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entities.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No entities yet. Use Onboard Entity to add one.</td></tr>
                  )}
                  {entities.map(e => (
                    <tr key={e.id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{e.name}</td>
                      <td style={{ ...tdStyle, color: '#555' }}>{e.email}</td>
                      <td style={tdStyle}>
                        <span style={{ background: '#e2e8f0', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
                          {ENTITY_TYPE_LABELS[e.entity_type] || e.entity_type}
                        </span>
                      </td>
                      <td style={tdStyle}><StatusBadge status={e.status} /></td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.72rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={e.did || ''}>{e.did || '—'}</td>
                      <td style={{ ...tdStyle, color: '#666' }}>{e.onboarded_by_name || '—'}</td>
                      <td style={{ ...tdStyle, color: '#888' }}>{new Date(e.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Onboard Entity ── */}
      {tab === 'entity-onboard' && (
        <>
          <h2 style={{ marginBottom: '1.5rem' }}>Onboard New Entity</h2>
          <div className="card" style={{ padding: '1.5rem', maxWidth: 560 }}>
            <p style={{ color: '#555', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              Submit an entity for onboarding. A checker (or super_admin) must approve the submission before the entity user account and DID are created.
            </p>
            <form onSubmit={handleOnboardSubmit}>
              <div className="form-group">
                <label>Entity Name *</label>
                <input className="form-input" value={onboardForm.name}
                  onChange={e => setOnboardForm(f => ({ ...f, name: e.target.value }))} required placeholder="e.g., National DID Authority" />
              </div>
              <div className="form-group">
                <label>Email *</label>
                <input className="form-input" type="email" value={onboardForm.email}
                  onChange={e => setOnboardForm(f => ({ ...f, email: e.target.value }))} required placeholder="admin@entity.gov.in" />
              </div>
              <div className="form-group">
                <label>Entity Type *</label>
                <select className="form-input" value={onboardForm.entity_type}
                  onChange={e => setOnboardForm(f => ({ ...f, entity_type: e.target.value }))}>
                  <option value="did_issuer">DID Issuer</option>
                  <option value="vc_issuer">VC Issuer</option>
                  <option value="trust_endorser">Trust Endorser</option>
                </select>
              </div>
              <div className="form-group">
                <label>Notes (optional)</label>
                <textarea className="form-input" value={onboardForm.notes}
                  onChange={e => setOnboardForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3} placeholder="Any relevant context for the checker..." />
              </div>
              <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Submitting...' : 'Submit for Approval'}</button>
            </form>
          </div>
        </>
      )}

      {/* ── Admin Queue ── */}
      {tab === 'admin-queue' && (
        <>
          <h2 style={{ marginBottom: '1.5rem' }}>Admin Queue <span style={{ fontSize: '0.875rem', color: '#888', fontWeight: 400 }}>({adminQueue.length} pending)</span></h2>
          {loading ? <p style={{ color: '#888' }}>Loading...</p> : adminQueue.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem', color: '#888' }}>No pending entity onboarding actions.</div>
          ) : (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {adminQueue.map(action => (
                <div key={action.id} className="card" style={{ padding: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.25rem' }}>{action.entity_name}</div>
                      <div style={{ color: '#555', fontSize: '0.875rem', marginBottom: '0.25rem' }}>{action.entity_email}</div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ background: '#e2e8f0', padding: '0.15rem 0.5rem', borderRadius: 10, fontSize: '0.75rem', fontWeight: 600 }}>
                          {ENTITY_TYPE_LABELS[action.entity_type] || action.entity_type}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: '#888' }}>Submitted by {action.maker_name} · {new Date(action.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                      <button className="btn btn-primary" style={{ padding: '0.3rem 0.85rem', fontSize: '0.85rem' }}
                        onClick={() => handleApprove(action.id)} disabled={loading}>
                        Approve & Activate
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '0.3rem 0.85rem', fontSize: '0.85rem', color: '#dc3545' }}
                        onClick={() => { setRejectingId(action.id); setRejectReason(''); }}>
                        Reject
                      </button>
                    </div>
                  </div>
                  {rejectingId === action.id && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #e2e8f0' }}>
                      <input className="form-input" placeholder="Rejection reason..." value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)} style={{ marginBottom: '0.5rem' }} />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-secondary" style={{ color: '#dc3545', padding: '0.3rem 0.75rem', fontSize: '0.85rem' }}
                          onClick={() => handleReject(action.id)} disabled={loading}>Confirm Reject</button>
                        <button className="btn btn-secondary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.85rem' }}
                          onClick={() => setRejectingId(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Admin Team ── */}
      {tab === 'admin-team' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: 0 }}>Admin Team</h2>
            <button className="btn btn-primary" onClick={() => setShowTeamForm(v => !v)}>
              {showTeamForm ? 'Cancel' : '+ Add Member'}
            </button>
          </div>

          {showTeamForm && (
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem', maxWidth: 560 }}>
              <h4 style={{ marginBottom: '1rem' }}>Add Team Member</h4>
              <form onSubmit={handleAddTeamMember}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Email *</label>
                    <input className="form-input" type="email" value={teamForm.email}
                      onChange={e => setTeamForm(f => ({ ...f, email: e.target.value }))} required />
                  </div>
                  <div className="form-group">
                    <label>Full Name *</label>
                    <input className="form-input" value={teamForm.name}
                      onChange={e => setTeamForm(f => ({ ...f, name: e.target.value }))} required />
                  </div>
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label>Sub Role *</label>
                    <select className="form-input" value={teamForm.sub_role}
                      onChange={e => setTeamForm(f => ({ ...f, sub_role: e.target.value }))}>
                      <option value="super_admin">Super Admin (Full access)</option>
                      <option value="maker">Maker (Onboards entities)</option>
                      <option value="checker">Checker (Reviews & activates)</option>
                    </select>
                  </div>
                </div>
                <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: '0.5rem' }}>
                  {loading ? 'Creating...' : 'Create Member'}
                </button>
              </form>
            </div>
          )}

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  {['Name', 'Email', 'Sub Role', 'Created'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teamMembers.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No admin team members yet.</td></tr>
                )}
                {teamMembers.map(m => (
                  <tr key={m.id}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{m.name}</td>
                    <td style={{ ...tdStyle, color: '#555' }}>{m.email}</td>
                    <td style={tdStyle}>
                      <span style={{
                        background: m.sub_role === 'super_admin' ? '#cfe2ff' : m.sub_role === 'maker' ? '#fff3cd' : '#d4edda',
                        color: m.sub_role === 'super_admin' ? '#0a367a' : m.sub_role === 'maker' ? '#856404' : '#155724',
                        padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, textTransform: 'capitalize'
                      }}>
                        {m.sub_role?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: '#888' }}>{new Date(m.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Authority Accounts ── */}
      {tab === 'authorities' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: 0 }}>Authority Accounts</h2>
            <button className="btn btn-primary" onClick={() => setShowCreateForm(true)}>+ Create Account</button>
          </div>

          {showCreateForm && (
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
              <h4 style={{ marginBottom: '1rem' }}>Create Authority Account</h4>
              <form onSubmit={handleCreate}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Email *</label>
                    <input className="form-input" type="email" value={createForm.email}
                      onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} required />
                  </div>
                  <div className="form-group">
                    <label>Full Name *</label>
                    <input className="form-input" value={createForm.name}
                      onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} required />
                  </div>
                  <div className="form-group">
                    <label>Authority Type *</label>
                    <select className="form-input" value={createForm.authority_type}
                      onChange={e => setCreateForm(f => ({ ...f, authority_type: e.target.value }))}>
                      {AUTHORITY_TYPES.map(t => <option key={t} value={t}>{AUTHORITY_LABELS[t]} ({t})</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Sub Role *</label>
                    <select className="form-input" value={createForm.sub_role}
                      onChange={e => setCreateForm(f => ({ ...f, sub_role: e.target.value }))}>
                      {AUTHORITY_SUB_ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                  <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? 'Creating...' : 'Create Account'}</button>
                  <button className="btn btn-secondary" type="button" onClick={() => setShowCreateForm(false)}>Cancel</button>
                </div>
              </form>
            </div>
          )}

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  {['Name', 'Email', 'Authority', 'Sub Role', 'Created', 'Actions'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {authorities.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No authority accounts yet.</td></tr>
                )}
                {authorities.map(a => (
                  <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{a.name}</td>
                    <td style={{ ...tdStyle, color: '#555' }}>{a.email}</td>
                    <td style={tdStyle}>
                      <span style={{ background: '#e2e8f0', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
                        {AUTHORITY_LABELS[a.authority_type] || a.authority_type}
                      </span>
                    </td>
                    <td style={{ ...tdStyle }}>{a.sub_role?.replace(/_/g, ' ') || '—'}</td>
                    <td style={{ ...tdStyle, color: '#888' }}>{new Date(a.created_at).toLocaleDateString()}</td>
                    <td style={tdStyle}>
                      {a.name.includes('[INACTIVE]') ? (
                        <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                          onClick={() => handleDeactivate(a.id, true)}>Activate</button>
                      ) : (
                        <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', color: '#dc3545' }}
                          onClick={() => handleDeactivate(a.id, false)}>Deactivate</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── DID Registry ── */}
      {tab === 'dids' && (
        <>
          <h2 style={{ marginBottom: '1.5rem' }}>DID Registry <span style={{ fontSize: '0.875rem', color: '#888', fontWeight: 400 }}>({didTotal} total)</span></h2>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  {['DID String', 'Type', 'Owner', 'Role', 'Created'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dids.map(d => (
                  <tr key={d.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.78rem', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={d.did_string}>{d.did_string}</td>
                    <td style={tdStyle}>
                      <span style={{ background: d.did_type === 'parent' ? '#e2e8f0' : '#f0f4ff', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
                        {d.did_type}
                      </span>
                    </td>
                    <td style={tdStyle}>{d.owner_name}</td>
                    <td style={{ ...tdStyle, color: '#555' }}>{d.owner_role}</td>
                    <td style={{ ...tdStyle, color: '#888' }}>{new Date(d.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'center' }}>
            <button className="btn btn-secondary" disabled={didPage === 1} onClick={() => setDidPage(p => p - 1)} style={{ padding: '0.3rem 0.75rem' }}>← Prev</button>
            <span style={{ padding: '0.3rem 0.75rem', color: '#666' }}>Page {didPage} of {Math.ceil(didTotal / 20) || 1}</span>
            <button className="btn btn-secondary" disabled={didPage * 20 >= didTotal} onClick={() => setDidPage(p => p + 1)} style={{ padding: '0.3rem 0.75rem' }}>Next →</button>
          </div>
        </>
      )}

      {/* ── Corporate / Members ── */}
      {tab === 'organizations' && (
        <>
          {/* Approve result banner */}
          {corpApproveResult && (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
              <div style={{ fontWeight: 700, color: '#15803d', marginBottom: '0.5rem' }}>✅ {corpApproveResult.message}</div>
              {corpApproveResult.superAdminTempPassword && (
                <div style={{ fontSize: '0.85rem', color: '#166534', marginBottom: '0.25rem' }}>
                  <strong>Super Admin temp password:</strong> <code style={{ background: '#dcfce7', padding: '2px 6px', borderRadius: 4 }}>{corpApproveResult.superAdminTempPassword}</code>
                </div>
              )}
              {corpApproveResult.requesterTempPassword && (
                <div style={{ fontSize: '0.85rem', color: '#166534' }}>
                  <strong>Requester temp password:</strong> <code style={{ background: '#dcfce7', padding: '2px 6px', borderRadius: 4 }}>{corpApproveResult.requesterTempPassword}</code>
                </div>
              )}
              <button className="btn btn-secondary btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => setCorpApproveResult(null)}>Dismiss</button>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: 0 }}>Corporate Applications</h2>
            <select className="form-input" value={corpAppFilter} onChange={e => setCorpAppFilter(e.target.value)} style={{ width: 200 }}>
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="signatory_approved">Signatory Approved</option>
              <option value="maker_reviewed">Maker Reviewed</option>
              <option value="issued">Issued / Active</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          {corpApplications.length === 0 ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: '#888' }}>No corporate applications found.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {corpApplications.map(app => {
                const isPending = ['pending', 'signatory_approved'].includes(app.application_status);
                const isActivated = ['issued', 'complete', 'partial', 'activated', 'maker_reviewed'].includes(app.application_status);
                const statusColor: Record<string, string> = {
                  pending: '#f59e0b', signatory_approved: '#3b82f6',
                  maker_reviewed: '#8b5cf6', issued: '#16a34a',
                  complete: '#16a34a', rejected: '#dc2626', activated: '#16a34a',
                };
                return (
                  <div key={app.id} className="card" style={{ padding: '1rem', borderLeft: `4px solid ${statusColor[app.application_status] || '#94a3b8'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}>{app.company_name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'monospace', marginTop: 2 }}>CIN: {app.cin || '—'}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: `${statusColor[app.application_status]}22`, color: statusColor[app.application_status] || '#64748b' }}>
                          {app.application_status.replace(/_/g, ' ').toUpperCase()}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{new Date(app.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.8rem', color: '#475569' }}>
                      <div><strong>Super Admin:</strong><br />{app.super_admin_name} <span style={{ color: '#94a3b8' }}>({app.super_admin_email})</span></div>
                      <div><strong>Requester:</strong><br />{app.requester_name || '—'} <span style={{ color: '#94a3b8' }}>({app.requester_email || '—'})</span></div>
                      <div><strong>Signatory:</strong><br />{app.signatory_name || '—'} <span style={{ color: '#94a3b8' }}>({app.signatory_email || '—'})</span></div>
                    </div>

                    {app.rejection_reason && (
                      <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#dc2626', background: '#fef2f2', padding: '6px 10px', borderRadius: 6 }}>
                        Rejected: {app.rejection_reason}
                      </div>
                    )}

                    {app.super_admin_exists && isActivated && (
                      <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#16a34a' }}>✓ Corporate user accounts created</div>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem', flexWrap: 'wrap' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setCorpViewApp(app)}>
                        👁 View Details
                      </button>
                      {isPending && (
                        <>
                          <button className="btn btn-primary btn-sm" style={{ background: '#16a34a', borderColor: '#16a34a' }}
                            onClick={() => handleCorpApprove(app.id)} disabled={loading}>
                            ✓ Approve & Activate
                          </button>
                          <button className="btn btn-secondary btn-sm" style={{ color: '#dc2626' }}
                            onClick={() => { setCorpRejectingId(app.id); setCorpViewApp(null); }}>
                            ✗ Reject
                          </button>
                        </>
                      )}
                    </div>

                    {/* Inline reject form */}
                    {corpRejectingId === app.id && (
                      <div style={{ marginTop: '0.75rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '0.75rem' }}>
                        <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#dc2626' }}>Rejection reason</div>
                        <textarea className="form-input" rows={2} value={corpRejectReason}
                          onChange={e => setCorpRejectReason(e.target.value)}
                          placeholder="State why this application is being rejected..." />
                        <div style={{ display: 'flex', gap: 8, marginTop: '0.5rem' }}>
                          <button className="btn btn-primary btn-sm" style={{ background: '#dc2626', borderColor: '#dc2626' }}
                            onClick={() => handleCorpReject(app.id)} disabled={loading}>
                            Confirm Reject
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => { setCorpRejectingId(null); setCorpRejectReason(''); }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* View Details Modal */}
          {corpViewApp && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
              onClick={() => setCorpViewApp(null)}>
              <div style={{ background: 'white', borderRadius: 12, padding: '1.5rem', maxWidth: 600, width: '100%', maxHeight: '80vh', overflow: 'auto' }}
                onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0 }}>{corpViewApp.company_name}</h3>
                  <button onClick={() => setCorpViewApp(null)} style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer' }}>✕</button>
                </div>
                {([
                  ['CIN', corpViewApp.cin], ['PAN', corpViewApp.pan_number], ['GSTN', corpViewApp.gstn],
                  ['State', corpViewApp.state], ['Incorporated', corpViewApp.date_of_incorporation],
                  ['Director', corpViewApp.director_full_name], ['Designation', corpViewApp.designation],
                  ['Super Admin', `${corpViewApp.super_admin_name} (${corpViewApp.super_admin_email})`],
                  ['Requester', `${corpViewApp.requester_name} (${corpViewApp.requester_email})`],
                  ['Signatory', `${corpViewApp.signatory_name} (${corpViewApp.signatory_email})`],
                  ['Status', corpViewApp.application_status],
                  ['Applied', new Date(corpViewApp.created_at).toLocaleString()],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', gap: '1rem', padding: '0.4rem 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.85rem' }}>
                    <div style={{ width: 120, fontWeight: 600, color: '#64748b', flexShrink: 0 }}>{label}</div>
                    <div style={{ color: '#0f172a' }}>{value || '—'}</div>
                  </div>
                ))}
                {['pending', 'signatory_approved'].includes(corpViewApp.application_status) && (
                  <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
                    <button className="btn btn-primary" style={{ background: '#16a34a', borderColor: '#16a34a' }}
                      onClick={() => handleCorpApprove(corpViewApp.id)} disabled={loading}>
                      ✓ Approve & Activate
                    </button>
                    <button className="btn btn-secondary" style={{ color: '#dc2626' }}
                      onClick={() => { setCorpRejectingId(corpViewApp.id); setCorpViewApp(null); }}>
                      ✗ Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}
