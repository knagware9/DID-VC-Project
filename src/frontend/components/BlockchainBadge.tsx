// src/frontend/components/BlockchainBadge.tsx
import React from 'react';

interface BlockchainBadgeProps {
  txHash?: string | null;
  blockNumber?: number | null;
  explorerUrl?: string | null;
  compact?: boolean;
}

export default function BlockchainBadge({ txHash, blockNumber, explorerUrl, compact = false }: BlockchainBadgeProps) {
  if (!txHash) return null;

  const isLive = blockNumber != null;
  const shortHash = `${txHash.slice(0, 8)}…${txHash.slice(-6)}`;

  if (compact) {
    return (
      <a
        href={isLive && explorerUrl ? explorerUrl : undefined}
        target={isLive && explorerUrl ? '_blank' : undefined}
        rel="noopener noreferrer"
        title={txHash}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: '0.72rem',
          fontFamily: 'monospace',
          padding: '2px 7px',
          borderRadius: 10,
          textDecoration: 'none',
          background: isLive ? '#dcfce7' : '#f1f5f9',
          color: isLive ? '#166534' : '#64748b',
          border: `1px solid ${isLive ? '#bbf7d0' : '#e2e8f0'}`,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: '0.6rem' }}>●</span>
        {shortHash}
      </a>
    );
  }

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '5px 10px',
      borderRadius: 8,
      background: isLive ? '#dcfce7' : '#f8fafc',
      border: `1px solid ${isLive ? '#86efac' : '#e2e8f0'}`,
      fontSize: '0.8rem',
      color: isLive ? '#166534' : '#64748b',
    }}>
      <span style={{ fontSize: '0.65rem' }}>●</span>
      <span style={{ fontWeight: 600 }}>{isLive ? 'On-Chain (Besu)' : 'Demo Anchored'}</span>
      <span style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{shortHash}</span>
      {isLive && explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#15803d', textDecoration: 'underline', fontSize: '0.72rem' }}
        >
          Besu Explorer ↗
        </a>
      )}
      {!isLive && (
        <span style={{ fontSize: '0.68rem', opacity: 0.7 }}>(demo)</span>
      )}
    </div>
  );
}
