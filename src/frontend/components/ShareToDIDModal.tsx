import React, { useState } from 'react';
import { api } from '../services/api';

interface Props {
  credentialId: string;
  credentialType: string;
  onClose: () => void;
  authToken: string;
}

export default function ShareToDIDModal({ credentialId, credentialType, onClose, authToken }: Props) {
  const [verifierDid, setVerifierDid] = useState('');
  const [purpose, setPurpose] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleShare() {
    if (!verifierDid.trim()) {
      setError('Please enter the verifier DID');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.shareToDID(authToken, {
        credentialIds: [credentialId],
        verifierDid: verifierDid.trim(),
        purpose: purpose.trim() || undefined,
      });
      setSuccess(`Credential shared successfully! Presentation ID: ${result.presentationId}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="card" style={{ maxWidth: 460, width: '90%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>Share to Verifier DID</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>

        <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1rem' }}>
          Share <strong>{credentialType}</strong> directly to a verifier's DID. They will see it in their "Received Credentials" tab.
        </p>

        {success ? (
          <>
            <div className="alert alert-success">{success}</div>
            <button className="btn btn-secondary" style={{ width: '100%', marginTop: '0.5rem' }} onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

            <div className="form-group">
              <label>Verifier DID</label>
              <input
                className="form-input"
                value={verifierDid}
                onChange={e => setVerifierDid(e.target.value)}
                placeholder="did:web:didvc.platform:verifier-name-xxxx"
                style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
              />
              <small style={{ color: '#888' }}>Ask the verifier for their DID string from the Verifier Portal.</small>
            </div>

            <div className="form-group">
              <label>Purpose (optional)</label>
              <input
                className="form-input"
                value={purpose}
                onChange={e => setPurpose(e.target.value)}
                placeholder="e.g. KYC verification, trade compliance check"
              />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleShare} disabled={loading}>
                {loading ? 'Sharing...' : 'Share Credential'}
              </button>
              <button className="btn btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
