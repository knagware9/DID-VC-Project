import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function SignatoryDashboard() {
  const { token } = useAuth();
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error' | ''>('');
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const authHeader = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  useEffect(() => { loadApplications(); }, [token]);

  async function loadApplications() {
    setLoading(true);
    try {
      const res = await fetch('/api/corporate/signatory/applications', { headers: authHeader() });
      let data: any = {};
      try { data = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setApplications(data.applications || []);
    } catch (e: any) {
      setMsg(e.message); setMsgType('error');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(appId: string) {
    if (actionLoading) return;
    setActionLoading(true);
    setMsg('');
    try {
      const res = await fetch(`/api/corporate/signatory/applications/${appId}/approve`, {
        method: 'POST', headers: authHeader(), body: '{}',
      });
      let data: any = {};
      try { data = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) throw new Error(data.error || 'Approval failed');
      setMsg('Application approved and submitted to DID Issuer.');
      setMsgType('success');
      loadApplications();
    } catch (e: any) { setMsg(e.message); setMsgType('error'); }
    finally { setActionLoading(false); }
  }

  async function handleReject(appId: string) {
    if (actionLoading) return;
    setActionLoading(true);
    setMsg('');
    try {
      const res = await fetch(`/api/corporate/signatory/applications/${appId}/reject`, {
        method: 'POST', headers: authHeader(),
        body: JSON.stringify({ rejection_reason: rejectReason }),
      });
      let data: any = {};
      try { data = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) throw new Error(data.error || 'Rejection failed');
      setMsg('Application rejected.');
      setMsgType('success');
      setRejectingId(null);
      setRejectReason('');
      loadApplications();
    } catch (e: any) { setMsg(e.message); setMsgType('error'); }
    finally { setActionLoading(false); }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontWeight: 800, color: '#0f172a', fontSize: '1.5rem', margin: 0 }}>Authorized Signatory</h1>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Review and approve corporate registration applications assigned to you.
          </p>
        </div>

        {msg && (
          <div style={{
            padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: '0.875rem',
            background: msgType === 'success' ? '#f0fdf4' : '#fef2f2',
            color: msgType === 'success' ? '#166534' : '#dc2626',
            border: `1px solid ${msgType === 'success' ? '#bbf7d0' : '#fecaca'}`,
          }}>
            {msg}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>Loading…</div>
        )}

        {!loading && applications.length === 0 && (
          <div style={{ background: 'white', borderRadius: 12, padding: '3rem', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📋</div>
            <div style={{ color: '#64748b', fontSize: '0.9rem' }}>No pending applications assigned to you.</div>
          </div>
        )}

        {applications.map((app: any) => {
          const docs: any[] = app.documents || [];
          return (
            <div key={app.id} style={{ background: 'white', borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>

              {/* Company header */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0f172a' }}>{app.company_name}</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.25rem' }}>
                  CIN: {app.cin} · Submitted: {new Date(app.created_at).toLocaleDateString()}
                </div>
                {app.assigned_issuer_name && (
                  <div style={{ fontSize: '0.78rem', color: '#2563eb', marginTop: '0.25rem' }}>
                    DID Issuer: {app.assigned_issuer_name}
                  </div>
                )}
              </div>

              {/* Key People */}
              <div style={{ background: '#eff6ff', borderRadius: 8, padding: '0.9rem', marginBottom: '1rem' }}>
                <div style={{ fontWeight: 700, color: '#2563eb', fontSize: '0.82rem', marginBottom: '0.5rem' }}>Key People</div>
                <div style={{ fontSize: '0.8rem', color: '#374151' }}>Super Admin: {app.super_admin_name} ({app.super_admin_email})</div>
                <div style={{ fontSize: '0.8rem', color: '#374151', marginTop: '0.25rem' }}>Requester: {app.requester_name} ({app.requester_email})</div>
              </div>

              {/* Documents */}
              {docs.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#374151', marginBottom: '0.5rem' }}>Documents</div>
                  {docs.map((doc: any, i: number) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0.75rem', borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0', marginBottom: '0.35rem', fontSize: '0.8rem' }}>
                      <div>
                        <span style={{ fontWeight: 600, color: '#1e293b' }}>{doc.vc_type}</span>
                        {doc.reference_number && <span style={{ color: '#64748b', marginLeft: '0.5rem' }}>{doc.reference_number}</span>}
                      </div>
                      {doc.file_path && (
                        <a href={`/${doc.file_path}`} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: '0.75rem', color: '#2563eb', textDecoration: 'none' }}>
                          📎 View
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Warning */}
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '0.8rem', color: '#92400e' }}>
                ⚠️ Approving this will submit the application to <strong>{app.assigned_issuer_name || 'the DID Issuer'}</strong> for DID issuance.
              </div>

              {/* Reject inline form */}
              {rejectingId === app.id && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: '0.5rem', fontSize: '0.85rem' }}>Rejection Reason (optional)</div>
                  <textarea
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="Reason for rejection…"
                    style={{ width: '100%', minHeight: 72, padding: '0.5rem', borderRadius: 6, border: '1px solid #fecaca', fontSize: '0.875rem', boxSizing: 'border-box', resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <button
                      disabled={actionLoading}
                      style={{ flex: 1, padding: '0.6rem', background: actionLoading ? '#94a3b8' : '#dc2626', color: 'white', border: 'none', borderRadius: 6, fontWeight: 700, cursor: actionLoading ? 'default' : 'pointer', fontSize: '0.875rem' }}
                      onClick={() => handleReject(app.id)}
                    >
                      Confirm Reject
                    </button>
                    <button
                      style={{ flex: 1, padding: '0.6rem', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: '0.875rem' }}
                      onClick={() => { setRejectingId(null); setRejectReason(''); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Actions */}
              {rejectingId !== app.id && (
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    style={{ flex: 1, padding: '0.75rem', background: '#f1f5f9', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}
                    onClick={() => setRejectingId(app.id)}
                  >
                    ✗ Reject
                  </button>
                  <button
                    disabled={actionLoading}
                    style={{ flex: 2, padding: '0.75rem', background: actionLoading ? '#94a3b8' : '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, cursor: actionLoading ? 'default' : 'pointer', fontSize: '0.9rem' }}
                    onClick={() => handleApprove(app.id)}
                  >
                    ✓ Approve & Submit to DID Issuer
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
