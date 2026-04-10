import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../services/api';

interface Props {
  credentialId: string;
  credentialType: string;
  onClose: () => void;
  authToken: string;
}

export default function QRShareModal({ credentialId, credentialType, onClose, authToken }: Props) {
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    generateQR();
  }, [credentialId]);

  async function generateQR() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.createShareQR(authToken, credentialId);
      setShareToken(result.token);
      setExpiresAt(result.expiresAt);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const shareUrl = shareToken ? `${window.location.origin}/share/${shareToken}` : '';

  function copyLink() {
    if (!shareUrl) return;
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="card" style={{ maxWidth: 420, width: '90%', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>Share via QR Code</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>

        <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1rem' }}>
          <strong>{credentialType}</strong> — Share this QR code with a verifier to present your credential without logging in.
        </p>

        {loading && <div style={{ padding: '2rem', color: '#888' }}>Generating QR code...</div>}

        {error && <div className="alert alert-error">{error}</div>}

        {shareToken && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '1rem 0' }}>
              <QRCodeSVG value={shareUrl} size={220} level="M" includeMargin />
            </div>

            <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.75rem', wordBreak: 'break-all' }}>
              {shareUrl}
            </div>

            {expiresAt && (
              <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '0.75rem' }}>
                Expires: {new Date(expiresAt).toLocaleDateString()}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
              <button className="btn btn-primary btn-sm" onClick={copyLink}>
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
