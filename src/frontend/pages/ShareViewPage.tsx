import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';

export default function ShareViewPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) loadShare();
  }, [token]);

  async function loadShare() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getSharedCredential(token!);
      setData(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '4rem', color: '#888' }}>
      <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🔍</div>
      Loading credential...
    </div>
  );

  if (error) return (
    <div style={{ maxWidth: 500, margin: '4rem auto', padding: '1rem' }}>
      <div className="alert alert-error">{error}</div>
      <p style={{ textAlign: 'center', color: '#888' }}>This share link may be expired or invalid.</p>
    </div>
  );

  if (!data) return null;

  const vc = data.presentation?.verifiableCredential?.[0] || {};
  const subject = vc.credentialSubject || {};
  const subjectEntries = Object.entries(subject).filter(([k]) => k !== 'id');

  return (
    <div style={{ maxWidth: 600, margin: '2rem auto', padding: '1rem' }}>
      <div className="card" style={{ textAlign: 'center', marginBottom: '1rem', background: data.revoked ? '#fff5f5' : '#f0fff4' }}>
        <div style={{ fontSize: '3rem' }}>{data.revoked ? '❌' : '✅'}</div>
        <div style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '0.5rem' }}>
          {data.revoked ? 'Credential Revoked' : 'Valid Credential'}
        </div>
        <div style={{ color: '#666', fontSize: '0.9rem' }}>{data.credentialType}</div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '1rem' }}>Credential Details</h3>

        {data.issuerDid && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#555' }}>Issuer</div>
            <code style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>{data.issuerDid}</code>
          </div>
        )}

        {data.issuedAt && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#555' }}>Issued</div>
            <div>{new Date(data.issuedAt).toLocaleDateString()}</div>
          </div>
        )}

        {data.expiresAt && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#555' }}>Expires</div>
            <div>{new Date(data.expiresAt).toLocaleDateString()}</div>
          </div>
        )}

        {subjectEntries.length > 0 && (
          <div style={{ marginTop: '1rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Credential Subject</div>
            {subjectEntries.map(([k, v]: [string, any]) => (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                <div style={{ fontWeight: 600, color: '#555' }}>{k}</div>
                <div>{String(v)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ textAlign: 'center', marginTop: '1rem', color: '#888', fontSize: '0.8rem' }}>
        Scanned {data.scannedCount} time{data.scannedCount !== 1 ? 's' : ''} &nbsp;|&nbsp; DID VC Platform
      </div>
    </div>
  );
}
