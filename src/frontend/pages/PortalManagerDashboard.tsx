import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

type Tab = 'overview' | 'authorities' | 'dids' | 'organizations';

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
  total_orgs: string; total_dids: string; total_vcs: string;
  pending_mc_actions: string; approved_orgs: string; rejected_orgs: string;
};

const AUTHORITY_TYPES = ['mca', 'dgft', 'gstn_trust_anchor', 'pan_trust_anchor'];
const AUTHORITY_SUB_ROLES = ['did_issuer_admin', 'vc_issuer_admin', 'maker', 'checker'];
const AUTHORITY_LABELS: Record<string, string> = {
  mca: 'MCA', dgft: 'DGFT', gstn_trust_anchor: 'GSTN', pan_trust_anchor: 'Income Tax',
};
const STATUS_COLORS: Record<string, string> = {
  pending: '#ffc107', partial: '#17a2b8', complete: '#28a745', rejected: '#dc3545',
};

export default function PortalManagerDashboard() {
  const { token, user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [authorities, setAuthorities] = useState<Authority[]>([]);
  const [dids, setDids] = useState<DIDRow[]>([]);
  const [didPage, setDidPage] = useState(1);
  const [didTotal, setDidTotal] = useState(0);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [orgStatusFilter, setOrgStatusFilter] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', name: '', authority_type: 'mca', sub_role: 'maker' });
  const [createdCred, setCreatedCred] = useState<{ email: string; tempPassword: string } | null>(null);
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
      setCreatedCred({ email: createForm.email, tempPassword: d.tempPassword });
      setShowCreateForm(false);
      setCreateForm({ email: '', name: '', authority_type: 'mca', sub_role: 'maker' });
      loadTab();
    } catch (e: any) { setMsg(e.message); }
    finally { setLoading(false); }
  }

  const tabStyle = (t: Tab) => ({
    padding: '0.5rem 1.25rem', border: 'none', cursor: 'pointer', borderRadius: 6,
    background: tab === t ? '#667eea' : '#f0f0f0',
    color: tab === t ? '#fff' : '#333', fontWeight: 600 as const, fontSize: '0.875rem',
  });

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f5f5f5' }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: '#fff', borderRight: '1px solid #e2e8f0', padding: '1.5rem 0', flexShrink: 0 }}>
        <div style={{ padding: '0 1.5rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ background: '#667eea', color: '#fff', display: 'inline-block', padding: '0.25rem 0.75rem', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700, marginBottom: '0.5rem' }}>PORTAL MANAGER</div>
          <div style={{ fontWeight: 700, color: '#333', fontSize: '0.9rem' }}>Platform Admin</div>
        </div>
        {(['overview', 'authorities', 'dids', 'organizations'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.75rem 1.5rem', border: 'none',
              background: tab === t ? '#f0f4ff' : 'transparent', color: tab === t ? '#667eea' : '#555',
              fontWeight: tab === t ? 600 : 400, cursor: 'pointer', textTransform: 'capitalize' }}>
            {t === 'dids' ? 'DID Registry' : t === 'authorities' ? 'Authority Accounts' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <button onClick={() => { logout(); }}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.75rem 1.5rem', border: 'none', background: 'transparent', color: '#dc3545', cursor: 'pointer', marginTop: '1rem' }}>
          Logout
        </button>
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: '2rem', overflow: 'auto' }}>
        {msg && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{msg} <button onClick={() => setMsg('')} style={{ marginLeft: '1rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button></div>}

        {/* Created credential modal */}
        {createdCred && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div className="card" style={{ width: 420, padding: '2rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔑</div>
              <h3 style={{ color: '#28a745', marginBottom: '1rem' }}>Account Created!</h3>
              <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '1rem', textAlign: 'left', marginBottom: '1.5rem' }}>
                <div style={{ marginBottom: '0.5rem' }}><strong>Email:</strong> {createdCred.email}</div>
                <div><strong>Temp Password:</strong> <code style={{ background: '#e2e8f0', padding: '0.2rem 0.5rem', borderRadius: 4 }}>{createdCred.tempPassword}</code></div>
              </div>
              <p style={{ color: '#666', fontSize: '0.85rem', marginBottom: '1.5rem' }}>Share these credentials securely with the authority officer. They should change their password on first login.</p>
              <button className="btn btn-primary" onClick={() => setCreatedCred(null)}>Done</button>
            </div>
          </div>
        )}

        {/* Overview Tab */}
        {tab === 'overview' && (
          <>
            <h2 style={{ marginBottom: '1.5rem' }}>Platform Overview</h2>
            {stats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                {[
                  { label: 'Total Organizations', value: stats.total_orgs, color: '#667eea' },
                  { label: 'Active DIDs', value: stats.total_dids, color: '#1a73e8' },
                  { label: 'VCs Issued', value: stats.total_vcs, color: '#28a745' },
                  { label: 'Pending MC Actions', value: stats.pending_mc_actions, color: '#ffc107' },
                  { label: 'Approved Orgs', value: stats.approved_orgs, color: '#28a745' },
                  { label: 'Rejected Orgs', value: stats.rejected_orgs, color: '#dc3545' },
                ].map(s => (
                  <div key={s.label} className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: s.color }}>{s.value || '0'}</div>
                    <div style={{ color: '#666', fontSize: '0.875rem', marginTop: '0.25rem' }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="card" style={{ padding: '1.25rem' }}>
              <h4 style={{ marginBottom: '0.75rem' }}>Portal Manager Profile</h4>
              <p><strong>Name:</strong> {user?.name}</p>
              <p><strong>Email:</strong> {user?.email}</p>
              <p><strong>Role:</strong> Portal Manager</p>
              <p><strong>Status:</strong> <span style={{ color: '#28a745', fontWeight: 600 }}>Active</span></p>
            </div>
          </>
        )}

        {/* Authority Accounts Tab */}
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
                      <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: '#555', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {authorities.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No authority accounts yet. Create the first one above.</td></tr>
                  )}
                  {authorities.map(a => (
                    <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{a.name}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: '#555' }}>{a.email}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ background: '#e2e8f0', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
                          {AUTHORITY_LABELS[a.authority_type] || a.authority_type}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{a.sub_role?.replace(/_/g, ' ') || '—'}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#888' }}>{new Date(a.created_at).toLocaleDateString()}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
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

        {/* DID Registry Tab */}
        {tab === 'dids' && (
          <>
            <h2 style={{ marginBottom: '1.5rem' }}>DID Registry <span style={{ fontSize: '0.875rem', color: '#888', fontWeight: 400 }}>({didTotal} total)</span></h2>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    {['DID String', 'Type', 'Owner', 'Role', 'Created'].map(h => (
                      <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: '#555', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dids.map(d => (
                    <tr key={d.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.78rem', color: '#333', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={d.did_string}>{d.did_string}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ background: d.did_type === 'parent' ? '#e2e8f0' : '#f0f4ff', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
                          {d.did_type}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{d.owner_name}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#555' }}>{d.owner_role}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#888' }}>{new Date(d.created_at).toLocaleDateString()}</td>
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

        {/* Organizations Tab */}
        {tab === 'organizations' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>Organizations</h2>
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
                      <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: '#555', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
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
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>{o.company_name}</td>
                        <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{o.cin}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{ background: STATUS_COLORS[o.application_status] + '22', color: STATUS_COLORS[o.application_status], padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600, textTransform: 'capitalize' }}>
                            {o.application_status}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span style={{ background: approvalCount === 4 ? '#d4edda' : '#fff3cd', color: approvalCount === 4 ? '#155724' : '#856404', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 700 }}>
                            {approvalCount}/4
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#888' }}>{new Date(o.created_at).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
