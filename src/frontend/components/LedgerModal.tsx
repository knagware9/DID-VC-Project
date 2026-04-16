// src/frontend/components/LedgerModal.tsx
import React, { useEffect, useState } from 'react';

interface BesuRef {
  txHash: string;
  blockNumber?: number | null;
  explorerUrl: string | null;
  mode: 'live' | 'demo';
  network?: string;
  anchoredAt?: string;
  vcHash?: string;
}

interface Trail {
  credentialId: string;
  vcId: string;
  credentialType: string;
  issuedAt: string;
  expiresAt?: string;
  revoked: boolean;
  issuer: {
    did: string;
    name?: string;
    email?: string;
    besu: BesuRef | null;
  };
  holder: {
    did: string;
    besu: BesuRef | null;
  };
  vcAnchor: BesuRef | null;
  verifications: Array<{
    id: string;
    status: string;
    verifiedAt: string;
    verifierName?: string;
    verifierEmail?: string;
    verifierDid?: string;
  }>;
}

interface Props {
  credentialId: string;
  credentialType?: string;
  token: string;
  onClose: () => void;
}

function shortHash(hash: string) {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function TxBadge({ data: p, label }: { data: BesuRef; label: string }) {
  const isLive = p.mode === 'live';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      background: isLive ? '#f0fdf4' : '#f8fafc',
      border: `1px solid ${isLive ? '#86efac' : '#e2e8f0'}`,
      borderRadius: 8, padding: '8px 12px', marginTop: 6,
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: '0.72rem', fontWeight: 700,
        color: isLive ? '#166534' : '#64748b',
        textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        <span style={{ fontSize: '0.6rem' }}>●</span>
        {isLive ? 'On-Chain (Besu)' : 'Demo Anchored'}
      </span>
      <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#334155' }}>
        {shortHash(p.txHash)}
      </span>
      {p.blockNumber != null && (
        <span style={{ fontSize: '0.7rem', color: isLive ? '#166534' : '#64748b', fontWeight: 600 }}>
          block #{p.blockNumber}
        </span>
      )}
      {isLive && p.explorerUrl ? (
        <a href={p.explorerUrl} target="_blank" rel="noopener noreferrer"
           style={{ fontSize: '0.72rem', color: '#15803d', textDecoration: 'underline' }}>
          Besu Explorer ↗
        </a>
      ) : isLive ? (
        <span style={{ fontSize: '0.7rem', color: '#166534', fontWeight: 500 }}>
          ✓ Confirmed on Hardhat/Besu Local Node
        </span>
      ) : (
        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>(demo — simulated)</span>
      )}
      {p.vcHash && (
        <span style={{ fontSize: '0.68rem', color: '#64748b', fontFamily: 'monospace' }}>
          VC hash: {p.vcHash.slice(0, 16)}…
        </span>
      )}
      {p.anchoredAt && (
        <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>anchored {fmt(p.anchoredAt)}</span>
      )}
    </div>
  );
}

function Step({
  n, title, subtitle, ts, color, children, done,
}: {
  n: number; title: string; subtitle?: string; ts?: string;
  color: string; children?: React.ReactNode; done: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 32 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: done ? color : '#e2e8f0',
          color: done ? '#fff' : '#94a3b8',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: '0.85rem', flexShrink: 0,
        }}>{done ? '✓' : n}</div>
        <div style={{ width: 2, flex: 1, background: '#e2e8f0', marginTop: 4 }} />
      </div>
      <div style={{ flex: 1, paddingBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600, color: done ? '#1e293b' : '#94a3b8', fontSize: '0.92rem' }}>{title}</span>
          {ts && <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{fmt(ts)}</span>}
        </div>
        {subtitle && <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>{subtitle}</div>}
        {done && children}
      </div>
    </div>
  );
}

export default function LedgerModal({ credentialId, credentialType, token, onClose }: Props) {
  const [trail, setTrail] = useState<Trail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/ledger/credential/${credentialId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => {
        if (d.success) setTrail(d.trail);
        else setError(d.error || 'Failed to load trail');
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [credentialId, token]);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 680,
        maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #1a56db 0%, #1e40af 100%)',
          padding: '20px 24px', borderRadius: '16px 16px 0 0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.3rem' }}>⛓</span>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: '1.1rem' }}>Transaction Ledger</span>
              <span style={{
                background: 'rgba(255,255,255,0.2)', color: '#fff',
                fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px',
                borderRadius: 10, letterSpacing: 0.5, textTransform: 'uppercase',
              }}>Hyperledger Besu</span>
            </div>
            <div style={{ color: '#bfdbfe', fontSize: '0.8rem', marginTop: 4 }}>
              {credentialType || 'Credential'} · {credentialId.slice(0, 8)}…
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
            borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: '0.9rem',
          }}>✕ Close</button>
        </div>

        <div style={{ padding: 24 }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
              Loading blockchain trail…
            </div>
          )}
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 16, color: '#dc2626' }}>
              {error}
            </div>
          )}

          {trail && (
            <>
              {/* Summary banner */}
              <div style={{
                background: trail.vcAnchor ? '#f0fdf4' : '#f8fafc',
                border: `1px solid ${trail.vcAnchor ? '#86efac' : '#e2e8f0'}`,
                borderRadius: 10, padding: '12px 16px', marginBottom: 24,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <span style={{ fontSize: '1.5rem' }}>{trail.vcAnchor ? '🟢' : '⚪'}</span>
                <div>
                  <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    {trail.vcAnchor?.mode === 'live' ? 'Live on Hyperledger Besu' : 'Demo Mode — Simulated Blockchain'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {trail.vcAnchor
                      ? `Network: ${trail.vcAnchor.network || 'dev'} · VC anchored ${trail.vcAnchor.blockNumber ? `block #${trail.vcAnchor.blockNumber}` : '(no block yet — demo)'}`
                      : 'No blockchain anchor found for this credential'}
                  </div>
                </div>
                {trail.revoked && (
                  <span style={{
                    marginLeft: 'auto', background: '#fee2e2', color: '#dc2626',
                    borderRadius: 6, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700,
                  }}>REVOKED</span>
                )}
              </div>

              {/* Timeline */}
              <div>
                <Step n={1} title="Holder DID Registered" done={!!trail.holder.did}
                  subtitle={trail.holder.did} color="#6366f1">
                  {trail.holder.besu && <TxBadge data={trail.holder.besu} label="DID Registration" />}
                  {!trail.holder.besu && (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>No Besu anchor yet</div>
                  )}
                </Step>

                <Step n={2} title="Issuer DID Registered" done={!!trail.issuer.did}
                  subtitle={`${trail.issuer.name || ''} · ${trail.issuer.did}`} color="#0891b2">
                  {trail.issuer.besu && <TxBadge data={trail.issuer.besu} label="Issuer DID" />}
                  {!trail.issuer.besu && (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>No Besu anchor yet</div>
                  )}
                </Step>

                <Step n={3} title={`VC Issued: ${trail.credentialType}`} done ts={trail.issuedAt}
                  subtitle={`VC ID: ${trail.vcId}`} color="#059669">
                  {trail.vcAnchor
                    ? <TxBadge data={trail.vcAnchor} label="VC Anchor" />
                    : <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>Not yet anchored to blockchain</div>
                  }
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 6 }}>
                    Expires: {trail.expiresAt ? fmt(trail.expiresAt) : 'No expiry'}
                  </div>
                </Step>

                {trail.verifications.length > 0 ? (
                  trail.verifications.map((v, i) => (
                    <Step key={v.id} n={4 + i} title={`Verified by ${v.verifierName || v.verifierEmail || 'Verifier'}`}
                      done={v.status === 'approved'} ts={v.verifiedAt}
                      subtitle={v.verifierDid}
                      color={v.status === 'approved' ? '#16a34a' : '#dc2626'}>
                      <div style={{
                        fontSize: '0.8rem', marginTop: 4,
                        color: v.status === 'approved' ? '#15803d' : '#dc2626',
                        fontWeight: 600,
                      }}>
                        {v.status === 'approved' ? '✓ Credential verified successfully' : `✗ ${(v as any).rejectionReason || 'Rejected'}`}
                      </div>
                    </Step>
                  ))
                ) : (
                  <Step n={4} title="Pending Verification" done={false}
                    subtitle="Not yet presented to any verifier" color="#94a3b8">
                  </Step>
                )}
              </div>

              {/* Raw VC ID footer */}
              <div style={{
                marginTop: 16, padding: '12px 16px',
                background: '#f8fafc', borderRadius: 8, borderLeft: '3px solid #e2e8f0',
              }}>
                <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, marginBottom: 4 }}>
                  CREDENTIAL ID (W3C VC)
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#334155', wordBreak: 'break-all' }}>
                  {trail.vcId}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
