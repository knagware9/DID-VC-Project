import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type AuthoritySlot = {
  status: 'pending' | 'approved' | 'rejected';
  vc_id: string | null;
  rejection_reason?: string;
  [key: string]: boolean | string | null | undefined;
};

type OrgApp = {
  id: string; org_name: string; email: string; director_full_name: string;
  aadhaar_number: string; dob: string; gender: string; state: string; pincode: string;
  company_name: string; cin: string; company_status: string; company_category: string;
  date_of_incorporation: string; pan_number: string; gstn: string; ie_code: string;
  director_name: string; din: string; designation: string; signing_authority_level: string;
  authority_verifications: Record<string, AuthoritySlot>;
  application_status: string; rejection_reason?: string; created_at: string; updated_at: string;
};

type Stats = { pending: string; approved: string; rejected: string; total: string };

const AUTHORITY_META: Record<string, { label: string; color: string }> = {
  mca:               { label: 'MCA',        color: '#1a73e8' },
  dgft:              { label: 'DGFT',       color: '#667eea' },
  gstn_trust_anchor: { label: 'GSTN',       color: '#28a745' },
  pan_trust_anchor:  { label: 'Income Tax', color: '#e67e22' },
};

const AUTHORITY_FIELDS: Record<string, { key: string; label: string; valueKey: keyof OrgApp }[]> = {
  mca: [
    { key: 'cin',          label: 'CIN',         valueKey: 'cin' },
    { key: 'company_name', label: 'Company Name', valueKey: 'company_name' },
  ],
  dgft: [
    { key: 'ie_code', label: 'IE Code', valueKey: 'ie_code' },
  ],
  gstn_trust_anchor: [
    { key: 'gstn', label: 'GSTN', valueKey: 'gstn' },
  ],
  pan_trust_anchor: [
    { key: 'pan', label: 'PAN Number', valueKey: 'pan_number' },
  ],
};

export default function AuthorityDashboard() {
  const { token, user, logout } = useAuth();
  const authorityType = (user as any)?.authority_type || 'dgft';
  const meta = AUTHORITY_META[authorityType] || AUTHORITY_META.dgft;
  const navigate = useNavigate();
  const [view, setView] = useState<'dashboard' | 'pending' | 'checker-queue'>('dashboard');
  const [mcQueue, setMcQueue] = useState<any[]>([]);
  const [orgs, setOrgs] = useState<OrgApp[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: '0', approved: '0', rejected: '0', total: '0' });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<OrgApp | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [showApprovedModal, setShowApprovedModal] = useState(false);
  const subRole = (user as any)?.sub_role;
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const authHeader = () => ({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' });

  useEffect(() => {
    loadOrgs();
    if (subRole === 'checker' || subRole === 'vc_issuer_admin') loadMCQueue();
  }, [view]);

  async function loadOrgs() {
    try {
      const res = await fetch('/api/authority/organizations?status=pending', { headers: authHeader() });
      const data = await res.json();
      setOrgs(data.organizations || []);
      setStats(data.stats || { pending: '0', approved: '0', rejected: '0', total: '0' });
    } catch { setMsg('Failed to load organizations'); }
  }

  async function loadMCQueue() {
    try {
      const res = await fetch('/api/mc/queue?resource_type=vc_issuance', { headers: authHeader() });
      const data = await res.json();
      setMcQueue(data.actions || []);
    } catch { setMsg('Failed to load checker queue'); }
  }

  async function toggleField(orgId: string, field: string, checked: boolean) {
    const res = await fetch(`/api/authority/organizations/${orgId}/verify-field`, {
      method: 'POST', headers: authHeader(),
      body: JSON.stringify({ field, verified: checked }),
    });
    const data = await res.json();
    if (data.authority_verifications && selected) {
      setSelected({ ...selected, authority_verifications: data.authority_verifications });
    } else if (data.error) {
      setMsg(data.error);
    }
  }

  async function handleMakerSubmit(orgId: string) {
    setLoading(true);
    try {
      const res = await fetch('/api/mc/submit', {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ resource_type: 'vc_issuance', resource_id: orgId, payload: { org_id: orgId } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg('Submitted for Checker approval. The action is now in the Checker queue.');
      setSelected(null);
    } catch (err: any) { setMsg(err.message); }
    finally { setLoading(false); }
  }

  async function handleApprove(orgId: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/authority/organizations/${orgId}/approve`, {
        method: 'POST', headers: authHeader(), body: '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSelected(null);
      setShowApprovedModal(true);
      loadOrgs();
    } catch (err: any) { setMsg(err.message); }
    finally { setLoading(false); }
  }

  async function handleReject(orgId: string) {
    if (!rejectReason.trim()) { setMsg('Please enter a rejection reason'); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/authority/organizations/${orgId}/reject`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ reason: rejectReason }),
      });
      if (!res.ok) throw new Error('Rejection failed');
      setSelected(null);
      setShowRejectInput(false);
      setRejectReason('');
      loadOrgs();
    } catch (err: any) { setMsg(err.message); }
    finally { setLoading(false); }
  }

  const allVerified = (org: OrgApp) => {
    const slot = org.authority_verifications?.[authorityType];
    if (!slot) return false;
    return Object.entries(slot)
      .filter(([k]) => k.startsWith('verified_'))
      .every(([, v]) => v === true);
  };
  const filtered = orgs.filter(o => o.company_name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f5f5f5' }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: '#fff', borderRight: '1px solid #e2e8f0', padding: '1.5rem 0' }}>
        <div style={{ padding: '0 1.5rem 1.5rem', borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ background: meta.color, color: '#fff', display: 'inline-block', padding: '0.25rem 0.75rem', borderRadius: 20, fontSize: '0.7rem', fontWeight: 600, marginBottom: '0.5rem' }}>{meta.label}</div>
          <div style={{ fontWeight: 700, color: '#333' }}>Authority Portal</div>
        </div>
        {[
          { key: 'dashboard', label: 'Dashboard' },
          { key: 'pending', label: 'Pending Requests' },
        ].map(item => (
          <button key={item.key} onClick={() => setView(item.key as any)}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.75rem 1.5rem', border: 'none', background: view === item.key ? '#f0f4ff' : 'transparent', color: view === item.key ? '#667eea' : '#555', fontWeight: view === item.key ? 600 : 400, cursor: 'pointer' }}>
            {item.label}
          </button>
        ))}
        {(subRole === 'checker' || subRole === 'vc_issuer_admin') && (
          <button onClick={() => setView('checker-queue')}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.75rem 1.5rem', border: 'none', background: view === 'checker-queue' ? '#f0f4ff' : 'transparent', color: view === 'checker-queue' ? '#667eea' : '#555', fontWeight: view === 'checker-queue' ? 600 : 400, cursor: 'pointer' }}>
            Checker Queue
          </button>
        )}
        <button onClick={() => { logout(); navigate('/login'); }}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.75rem 1.5rem', border: 'none', background: 'transparent', color: '#dc3545', cursor: 'pointer', marginTop: 'auto' }}>
          Logout
        </button>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: '2rem' }}>
        {msg && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{msg}<button onClick={() => setMsg('')} style={{ marginLeft: '1rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button></div>}

        {view === 'dashboard' && (
          <>
            <h2 style={{ marginBottom: '1.5rem' }}>Dashboard</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
              {[
                { label: 'Pending Requests', value: stats.pending, color: '#ffa500' },
                { label: 'Approved', value: stats.approved, color: '#28a745' },
                { label: 'Rejected', value: stats.rejected, color: '#dc3545' },
                { label: 'Total Organizations', value: stats.total, color: '#667eea' },
              ].map(s => (
                <div key={s.label} className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ color: '#666', fontSize: '0.875rem' }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div className="card" style={{ padding: '1.25rem' }}>
              <h4 style={{ marginBottom: '0.75rem' }}>Profile Information</h4>
              <p><strong>Name:</strong> {user?.name}</p>
              <p><strong>Email:</strong> {user?.email}</p>
              <p><strong>Role:</strong> Government Agency ({meta.label})</p>
              <p><strong>Status:</strong> <span style={{ color: '#28a745', fontWeight: 600 }}>Active</span></p>
            </div>
          </>
        )}

        {view === 'checker-queue' && (
          <div>
            <h2 style={{ marginBottom: '1rem' }}>Checker Queue</h2>
            {mcQueue.length === 0 ? (
              <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>No pending actions in the queue.</div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8f9fa' }}>
                      {['Resource ID', 'Submitted By', 'Created', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: '#555', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mcQueue.map((action: any) => (
                      <tr key={action.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.78rem' }}>{action.resource_id}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{action.maker_id}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: '#888' }}>{new Date(action.created_at).toLocaleDateString()}</td>
                        <td style={{ padding: '0.75rem 1rem', display: 'flex', gap: '0.5rem' }}>
                          <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                            onClick={async () => {
                              setLoading(true);
                              try {
                                const r = await fetch(`/api/mc/${action.id}/approve`, { method: 'POST', headers: authHeader(), body: '{}' });
                                const d = await r.json();
                                if (!r.ok) throw new Error(d.error);
                                setShowApprovedModal(true);
                                loadMCQueue();
                              } catch (e: any) { setMsg(e.message); }
                              finally { setLoading(false); }
                            }}>
                            Approve
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', color: '#dc3545' }}
                            onClick={async () => {
                              const reason = prompt('Rejection reason:');
                              if (!reason) return;
                              const r = await fetch(`/api/mc/${action.id}/reject`, { method: 'POST', headers: authHeader(), body: JSON.stringify({ reason }) });
                              if (r.ok) loadMCQueue();
                              else { const d = await r.json(); setMsg(d.error); }
                            }}>
                            Reject
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {view === 'pending' && (
          <>
            <h2 style={{ marginBottom: '1rem' }}>Pending Requests</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
              {[
                { label: 'Total Pending', value: stats.pending },
                { label: 'This Week', value: orgs.filter(o => new Date(o.created_at) > new Date(Date.now() - 7 * 86400000)).length },
                { label: 'Awaiting Action', value: stats.pending },
              ].map(s => (
                <div key={s.label} className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#667eea' }}>{s.value}</div>
                  <div style={{ color: '#666', fontSize: '0.875rem' }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
              <input className="form-control" placeholder="Search by organization name..." value={search}
                onChange={e => setSearch(e.target.value)} style={{ maxWidth: 400 }} />
            </div>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8f9fa' }}>
                    {['Organization', 'Director', 'CIN', 'Applied Date', 'Authority', 'Status', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.875rem', color: '#555', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>No pending applications</td></tr>
                  )}
                  {filtered.map(org => (
                    <tr key={org.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <div style={{ fontWeight: 600 }}>{org.company_name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#888' }}>{org.email}</div>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{org.director_name}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontFamily: 'monospace' }}>{org.cin}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{new Date(org.created_at).toLocaleDateString()}</td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span style={{ background: meta.color, color: '#fff', padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>{meta.label}</span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        {(() => {
                          const slotStatus = org.authority_verifications?.[authorityType]?.status || 'pending';
                          const statusStyles: Record<string, { bg: string; color: string }> = {
                            pending:  { bg: '#fff3cd', color: '#856404' },
                            approved: { bg: '#d4edda', color: '#155724' },
                            rejected: { bg: '#f8d7da', color: '#721c24' },
                          };
                          const s = statusStyles[slotStatus] || statusStyles.pending;
                          return (
                            <span style={{ background: s.bg, color: s.color, padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>
                              {slotStatus.charAt(0).toUpperCase() + slotStatus.slice(1)}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <button className="btn btn-primary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem', marginRight: '0.5rem' }}
                          onClick={() => { setSelected(org); setShowRejectInput(false); setRejectReason(''); }}>
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Details Modal */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="card" style={{ width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0 }}>Application Details</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#666' }}>✕</button>
            </div>

            {[
              { title: 'Individual Details', rows: [
                ['Full Name', selected.director_full_name], ['Aadhaar Number', selected.aadhaar_number],
                ['Date of Birth', selected.dob], ['Gender', selected.gender],
                ['State', selected.state], ['Pincode', selected.pincode],
              ]},
              { title: 'Company Details', rows: [
                ['Company Name', selected.company_name], ['CIN', selected.cin],
                ['Status', selected.company_status], ['Category', selected.company_category],
                ['Date of Incorporation', selected.date_of_incorporation],
                ['PAN Number', selected.pan_number], ['GSTN', selected.gstn],
              ]},
              { title: 'Director Details', rows: [
                ['Director Name', selected.director_name], ['DIN', selected.din],
                ['Designation', selected.designation], ['Signing Authority Level', selected.signing_authority_level],
              ]},
            ].map(section => (
              <div key={section.title} style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ color: '#667eea', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>{section.title}</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {section.rows.map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontSize: '0.75rem', color: '#888' }}>{k}</div>
                      <div style={{ fontWeight: 500 }}>{v || '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Application Status */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ color: '#667eea', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>Application Status</h4>
              <span style={{ background: '#fff3cd', color: '#856404', padding: '0.25rem 0.75rem', borderRadius: 12, fontSize: '0.8rem', fontWeight: 600 }}>{selected.application_status.toUpperCase()}</span>
              <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#666' }}>
                <span>Created: {new Date(selected.created_at).toLocaleString()}</span>
                <span style={{ marginLeft: '1rem' }}>Updated: {new Date(selected.updated_at).toLocaleString()}</span>
              </div>
            </div>

            {/* Authority Approvals */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ color: '#667eea', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>Authority Approvals</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ background: meta.color, color: '#fff', padding: '0.25rem 0.75rem', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>{meta.label}</span>
                <span style={{ color: '#666', fontSize: '0.875rem' }}>{authorityType === 'mca' ? 'Ministry of Corporate Affairs' : authorityType === 'dgft' ? 'Director General of Foreign Trade' : authorityType === 'gstn_trust_anchor' ? 'GST Network Trust Anchor' : 'Income Tax / PAN Trust Anchor'}</span>
              </div>
            </div>

            {/* Authority Verification Checkboxes */}
            <div style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ color: meta.color, borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>{meta.label} Verification</h4>
              {(AUTHORITY_FIELDS[authorityType] || []).map(field => {
                const isVerified = selected.authority_verifications?.[authorityType]?.[`verified_${field.key}`] === true;
                return (
                  <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <input type="checkbox" checked={isVerified}
                      onChange={e => toggleField(selected.id, field.key, e.target.checked)}
                      style={{ width: 16, height: 16, cursor: 'pointer' }} />
                    <span style={{ fontWeight: 500 }}>{field.label}</span>
                    <span style={{ fontFamily: 'monospace', color: '#555', fontSize: '0.875rem' }}>({String(selected[field.valueKey] || '—')})</span>
                    {isVerified && (
                      <span style={{ background: '#d4edda', color: '#155724', padding: '0.15rem 0.5rem', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600 }}>Verified</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {(subRole === 'maker' || subRole === 'vc_issuer_admin') && (
                <button className="btn btn-primary"
                  disabled={!allVerified(selected) || loading}
                  onClick={() => handleMakerSubmit(selected.id)}
                  style={{ opacity: allVerified(selected) ? 1 : 0.5 }}>
                  {loading ? 'Submitting...' : subRole === 'vc_issuer_admin' ? 'Approve (Admin Override)' : 'Submit for Checker Approval'}
                </button>
              )}
              {(subRole === 'maker' || subRole === 'vc_issuer_admin' || !subRole) && (
                <button className="btn btn-danger" disabled={loading} onClick={() => setShowRejectInput(true)}>Reject</button>
              )}
            </div>

            {showRejectInput && (
              <div style={{ marginTop: '1rem' }}>
                <textarea className="form-control" rows={3} placeholder="Enter rejection reason..."
                  value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                  style={{ marginBottom: '0.5rem' }} />
                <button className="btn btn-danger" onClick={() => handleReject(selected.id)}>
                  Confirm Rejection
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Approved Modal */}
      {showApprovedModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: 420, padding: '2.5rem', textAlign: 'center' }}>
            <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>✅</div>
            <h2 style={{ color: '#28a745', marginBottom: '1rem' }}>Organization Approved!</h2>
            <div style={{ textAlign: 'left', background: '#f8f9fa', borderRadius: 8, padding: '1rem', marginBottom: '1.5rem' }}>
              <p style={{ margin: '0.25rem 0' }}>✓ Credentials sent to registered corporate email</p>
              <p style={{ margin: '0.25rem 0' }}>✓ API Key and Access Token generated</p>
              <p style={{ margin: '0.25rem 0' }}>✓ Portal access enabled</p>
            </div>
            <button className="btn btn-primary" onClick={() => setShowApprovedModal(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
