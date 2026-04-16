import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAppShell } from '../components/AppShell';

type Tab = 'overview' | 'authorities' | 'dids' | 'organizations' | 'entities' | 'entity-onboard' | 'admin-queue' | 'admin-team' | 'applications';

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

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Corp Applications tab state
  const [corpApps, setCorpApps] = useState<any[]>([]);
  const [availableIssuers, setAvailableIssuers] = useState<any[]>([]);
  const [selectedIssuer, setSelectedIssuer] = useState<Record<string, string>>({});
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [appMsg, setAppMsg] = useState('');

  const [createdCred, setCreatedCred] = useState<{ email: string; tempPassword: string; did?: string; label?: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const authHeader = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  useEffect(() => { loadTab(); }, [tab, didPage, orgStatusFilter]);

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
        const qs = orgStatusFilter ? `?status=${orgStatusFilter}` : '';
        const r = await fetch(`/api/portal/organizations${qs}`, { headers: authHeader() });
        const d = await r.json();
        setOrgs(d.organizations || []);
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
      } else if (tab === 'applications') {
        const [appsRes, issuersRes] = await Promise.all([
          fetch('/api/portal/corporate-applications', { headers: authHeader() }),
          fetch('/api/public/did-issuers'),
        ]);
        const appsData = await appsRes.json();
        const issuersData = await issuersRes.json();
        setCorpApps(appsData.applications || []);
        setAvailableIssuers(issuersData.issuers || []);
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

  async function handleActivate(appId: string) {
    const issuerId = selectedIssuer[appId];
    if (!issuerId) { setAppMsg('Please select a DID Issuer first'); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/portal/corporate-applications/${appId}/activate`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ assigned_issuer_id: issuerId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setAppMsg('Application activated and assigned to issuer.');
      loadTab();
    } catch (e: any) { setAppMsg(e.message); }
    finally { setLoading(false); }
  }

  async function handleRejectApp(appId: string) {
    const reason = window.prompt('Rejection reason (optional):');
    if (reason === null) return; // cancelled
    setLoading(true);
    try {
      const r = await fetch(`/api/portal/corporate-applications/${appId}/reject`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ rejection_reason: reason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setAppMsg('Application rejected.');
      loadTab();
    } catch (e: any) { setAppMsg(e.message); }
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: 0 }}>Corporate / Members</h2>
            <select className="form-input" value={orgStatusFilter} onChange={e => setOrgStatusFilter(e.target.value)} style={{ width: 180 }}>
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="complete">Complete</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8f9fa' }}>
                  {['Company Name', 'CIN', 'Status', 'Approvals', 'Applied'].map(h => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orgs.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No organizations found.</td></tr>
                )}
                {orgs.map(o => {
                  const approvalCount = Object.values(o.authority_verifications || {})
                    .filter((v: any) => v.status === 'approved').length;
                  return (
                    <tr key={o.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{o.company_name}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.8rem' }}>{o.cin}</td>
                      <td style={tdStyle}><StatusBadge status={o.application_status} /></td>
                      <td style={tdStyle}>
                        <span style={{ background: approvalCount === 4 ? '#d4edda' : '#fff3cd', color: approvalCount === 4 ? '#155724' : '#856404', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 700 }}>
                          {approvalCount}/4
                        </span>
                      </td>
                      <td style={{ ...tdStyle, color: '#888' }}>{new Date(o.created_at).toLocaleDateString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Corp Applications ── */}
      {tab === 'applications' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: 0 }}>Corporate Applications</h2>
            {appMsg && <span style={{ color: appMsg.includes('error') || appMsg.includes('select') ? '#dc3545' : '#16a34a', fontSize: '0.875rem' }}>{appMsg}</span>}
          </div>

          {corpApps.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#888' }}>No corporate applications yet.</div>
          )}

          {corpApps.map(app => {
            const statusColor: Record<string, string> = {
              pending: '#fef3c7', activated: '#dbeafe', issued: '#dcfce7', rejected: '#fee2e2',
            };
            const statusText: Record<string, string> = {
              pending: '#92400e', activated: '#1e40af', issued: '#166534', rejected: '#991b1b',
            };
            return (
              <div key={app.id} className="card" style={{ marginBottom: '1rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1rem' }}>{app.company_name}</div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>CIN: {app.cin}</div>
                    <div style={{ fontSize: '0.78rem', color: '#374151', marginTop: '0.25rem' }}>
                      Admin: {app.super_admin_name} ({app.super_admin_email}) · Requester: {app.requester_name} ({app.requester_email})
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                      Submitted: {new Date(app.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span style={{
                    background: statusColor[app.application_status] || '#f1f5f9',
                    color: statusText[app.application_status] || '#374151',
                    fontSize: '0.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: 8,
                  }}>
                    {app.application_status.toUpperCase()}
                  </span>
                </div>

                {/* Expand/collapse documents */}
                <button
                  style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '0.8rem', cursor: 'pointer', padding: '0.25rem 0', fontWeight: 600 }}
                  onClick={() => setExpandedApp(expandedApp === app.id ? null : app.id)}
                >
                  {expandedApp === app.id ? '▲ Hide Documents' : '▼ Show Documents'}
                </button>

                {expandedApp === app.id && (
                  <div style={{ marginTop: '0.75rem', background: '#f8fafc', borderRadius: 6, padding: '0.75rem' }}>
                    {(app.documents || []).length === 0 ? (
                      <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>No documents</span>
                    ) : (
                      (app.documents as any[]).map((doc: any, i: number) => (
                        <div key={i} style={{ fontSize: '0.8rem', color: '#374151', marginBottom: '0.35rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <span>📄 {doc.vc_type}</span>
                          {doc.reference_number && <span style={{ color: '#64748b' }}>ref: {doc.reference_number}</span>}
                          {doc.file_path && (
                            <a href={`/${doc.file_path}`} target="_blank" rel="noopener noreferrer"
                              style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>
                              Download ↗
                            </a>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Actions for pending applications */}
                {app.application_status === 'pending' && (
                  <div style={{ marginTop: '1rem', borderTop: '1px solid #f1f5f9', paddingTop: '1rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '0.5rem' }}>Assign to DID Issuer</div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      <select
                        style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.85rem', color: '#1e293b' }}
                        value={selectedIssuer[app.id] || ''}
                        onChange={e => setSelectedIssuer(prev => ({ ...prev, [app.id]: e.target.value }))}
                      >
                        <option value="">Select DID Issuer…</option>
                        {availableIssuers.map((iss: any) => (
                          <option key={iss.id} value={iss.id}>{iss.name}</option>
                        ))}
                      </select>
                      <button
                        style={{ padding: '0.5rem 1rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
                        onClick={() => handleActivate(app.id)} disabled={loading}
                      >
                        ✓ Activate & Assign
                      </button>
                      <button
                        style={{ padding: '0.5rem 1rem', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 6, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
                        onClick={() => handleRejectApp(app.id)} disabled={loading}
                      >
                        ✗ Reject
                      </button>
                    </div>
                  </div>
                )}

                {/* Activated: show assigned issuer */}
                {app.application_status === 'activated' && (
                  <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#1e40af', background: '#dbeafe', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
                    Assigned to: {app.assigned_issuer_name || 'DID Issuer'} — awaiting issuance
                  </div>
                )}

                {/* Issued */}
                {app.application_status === 'issued' && (
                  <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#166534', background: '#dcfce7', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
                    🎉 Issued by {app.assigned_issuer_name || 'DID Issuer'} — corporate accounts created
                  </div>
                )}

                {/* Rejected */}
                {app.application_status === 'rejected' && (
                  <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#991b1b', background: '#fee2e2', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
                    Rejected{app.rejection_reason ? `: ${app.rejection_reason}` : ''}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
