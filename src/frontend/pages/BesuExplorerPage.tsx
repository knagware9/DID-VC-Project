import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

type Overview = {
  blockNumber: number; chainId: number; totalTransactions: number;
  didRegistryAddress: string; vcRegistryAddress: string;
  rpcUrl: string; network: string;
  latestBlock: { number: number; hash: string; timestamp: number; txCount: number; gasUsed: number };
};

type TxSummary = {
  hash: string; blockNumber: number; timestamp: number;
  from: string; to: string | null; gas: number;
  contract: string; type: 'DID' | 'VC' | 'deploy' | 'transfer';
  credential?: { credential_type: string; issued_at: string; holder_did: string; holder_name: string } | null;
};

type Block = {
  number: number; hash: string; timestamp: number; txCount: number;
  gasUsed: number; gasLimit: number; miner: string;
  transactions: TxSummary[];
};

type TxDetail = {
  hash: string; blockNumber: number; from: string; to: string | null;
  value: number; gas: number; gasUsed: number | null; status: string;
  input: string; contract: string; type: string;
  credential: any; did: any; logs: any[];
};

const TYPE_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  DID:     { bg: '#dbeafe', color: '#1d4ed8', label: '🔑 DID' },
  VC:      { bg: '#dcfce7', color: '#15803d', label: '📄 VC' },
  deploy:  { bg: '#fef3c7', color: '#92400e', label: '🚀 Deploy' },
  transfer:{ bg: '#f3e8ff', color: '#7e22ce', label: '💸 Transfer' },
};

function TypeBadge({ type }: { type: string }) {
  const c = TYPE_COLORS[type] || { bg: '#f1f5f9', color: '#475569', label: type };
  return (
    <span style={{ background: c.bg, color: c.color, padding: '0.2rem 0.6rem', borderRadius: 12, fontSize: '0.72rem', fontWeight: 700 }}>
      {c.label}
    </span>
  );
}

function shortHash(h: string, len = 14) {
  if (!h) return '—';
  return `${h.slice(0, len)}…${h.slice(-6)}`;
}

function timeAgo(ts: number) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return new Date(ts * 1000).toLocaleString();
}

export default function BesuExplorerPage() {
  const { token } = useAuth();
  const [view, setView] = useState<'overview' | 'blocks' | 'transactions' | 'tx'>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [transactions, setTransactions] = useState<TxSummary[]>([]);
  const [selectedTx, setSelectedTx] = useState<TxDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [blockPage, setBlockPage] = useState(1);
  const [totalBlocks, setTotalBlocks] = useState(0);
  const [filter, setFilter] = useState('all');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  const loadOverview = useCallback(async () => {
    try {
      const r = await fetch('/api/besu/explorer/overview', { headers });
      const d = await r.json();
      if (d.success) setOverview(d);
    } catch (e: any) { setError(e.message); }
  }, []);

  const loadBlocks = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/besu/explorer/blocks?page=${page}&limit=15`, { headers });
      const d = await r.json();
      if (d.success) { setBlocks(d.blocks); setTotalBlocks(d.totalBlocks); }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/besu/explorer/transactions?limit=100', { headers });
      const d = await r.json();
      if (d.success) setTransactions(d.transactions);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  const loadTx = async (hash: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/besu/explorer/tx/${hash}`, { headers });
      const d = await r.json();
      if (d.success) { setSelectedTx(d.transaction); setView('tx'); }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadOverview(); }, []);

  useEffect(() => {
    if (view === 'blocks') loadBlocks(blockPage);
    else if (view === 'transactions') loadTransactions();
  }, [view, blockPage]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => { loadOverview(); if (view === 'transactions') loadTransactions(); }, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, view]);

  const filteredTxns = filter === 'all' ? transactions : transactions.filter(t => t.type === filter);

  const thStyle: React.CSSProperties = { padding: '0.65rem 1rem', textAlign: 'left', fontWeight: 600, fontSize: '0.8rem', color: '#64748b', borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap' };
  const tdStyle: React.CSSProperties = { padding: '0.65rem 1rem', fontSize: '0.82rem', borderBottom: '1px solid #f1f5f9' };

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#f8fafc' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ fontSize: '2rem' }}>⛓️</div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>Besu Block Explorer</h2>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.1rem' }}>
              Hyperledger Besu · Chain ID {overview?.chainId || 31337} · {overview?.rpcUrl || 'http://localhost:8545'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.78rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh (5s)
          </label>
          <button onClick={() => { loadOverview(); if (view === 'transactions') loadTransactions(); if (view === 'blocks') loadBlocks(blockPage); }}
            style={{ padding: '0.4rem 0.9rem', background: '#1a56db', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem' }}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && <div style={{ background: '#fee2e2', color: '#dc2626', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: '0.85rem' }}>{error}<button onClick={() => setError('')} style={{ marginLeft: '1rem', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button></div>}

      {/* ── Status Cards ── */}
      {overview && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
          {[
            { icon: '🟢', label: 'Status', value: 'Live', sub: overview.network.toUpperCase(), color: '#16a34a' },
            { icon: '📦', label: 'Latest Block', value: `#${overview.blockNumber}`, sub: `${overview.latestBlock.txCount} txns`, color: '#1d4ed8' },
            { icon: '📋', label: 'Transactions', value: overview.totalTransactions, sub: 'on-chain', color: '#7c3aed' },
            { icon: '⛽', label: 'Gas Used (latest)', value: overview.latestBlock.gasUsed.toLocaleString(), sub: 'units', color: '#ea580c' },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', borderRadius: 10, padding: '1rem 1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', borderTop: `3px solid ${s.color}` }}>
              <div style={{ fontSize: '1.3rem', marginBottom: '0.25rem' }}>{s.icon}</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.15rem' }}>{s.label}</div>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Contract Cards ── */}
      {overview && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
          {[
            { label: 'DID Registry Contract', addr: overview.didRegistryAddress, icon: '🔑', color: '#1d4ed8' },
            { label: 'VC Registry Contract', addr: overview.vcRegistryAddress, icon: '📄', color: '#15803d' },
          ].map(c => (
            <div key={c.label} style={{ background: '#fff', borderRadius: 10, padding: '1rem 1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ fontSize: '1.8rem' }}>{c.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#334155' }}>{c.label}</div>
                <code style={{ fontSize: '0.75rem', color: c.color, wordBreak: 'break-all' }}>{c.addr || '—'}</code>
              </div>
              <div style={{ background: '#dcfce7', color: '#15803d', padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ Deployed</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Nav Tabs ── */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', background: '#fff', borderRadius: 10, padding: '0.35rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', width: 'fit-content' }}>
        {(['overview', 'blocks', 'transactions'] as const).map(tab => (
          <button key={tab} onClick={() => setView(tab)}
            style={{ padding: '0.5rem 1.25rem', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', background: view === tab ? '#1a56db' : 'transparent', color: view === tab ? '#fff' : '#64748b', transition: 'all 0.15s' }}>
            {tab === 'overview' ? '🏠 Overview' : tab === 'blocks' ? '📦 Blocks' : '📋 Transactions'}
          </button>
        ))}
        {view === 'tx' && (
          <button style={{ padding: '0.5rem 1.25rem', borderRadius: 7, border: 'none', cursor: 'default', fontWeight: 600, fontSize: '0.85rem', background: '#1a56db', color: '#fff' }}>
            🔍 Transaction
          </button>
        )}
      </div>

      {/* ── Overview Tab ── */}
      {view === 'overview' && overview && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: '1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem', color: '#334155' }}>⛓️ Network Info</h3>
            {[
              ['Network', overview.network.toUpperCase()],
              ['Chain ID', overview.chainId],
              ['RPC URL', overview.rpcUrl],
              ['Latest Block', `#${overview.blockNumber}`],
              ['Total Transactions', overview.totalTransactions],
            ].map(([k, v]) => (
              <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.85rem' }}>
                <span style={{ color: '#64748b' }}>{k}</span>
                <span style={{ fontWeight: 600, color: '#1e293b' }}>{v}</span>
              </div>
            ))}
          </div>

          <div style={{ background: '#fff', borderRadius: 10, padding: '1.25rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem', color: '#334155' }}>📦 Latest Block #{overview.latestBlock.number}</h3>
            {[
              ['Block Hash', shortHash(overview.latestBlock.hash, 20)],
              ['Timestamp', timeAgo(overview.latestBlock.timestamp)],
              ['Transactions', overview.latestBlock.txCount],
              ['Gas Used', overview.latestBlock.gasUsed.toLocaleString()],
            ].map(([k, v]) => (
              <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.85rem' }}>
                <span style={{ color: '#64748b' }}>{k}</span>
                <span style={{ fontWeight: 600, color: '#1e293b' }}>{v}</span>
              </div>
            ))}
            <button onClick={() => setView('blocks')} style={{ marginTop: '1rem', width: '100%', padding: '0.5rem', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', color: '#1a56db', fontWeight: 600 }}>
              View All Blocks →
            </button>
          </div>
        </div>
      )}

      {/* ── Blocks Tab ── */}
      {view === 'blocks' && (
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#334155' }}>📦 All Blocks ({totalBlocks} total)</h3>
          </div>
          {loading ? <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading blocks…</div> : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Block', 'Age', 'Txns', 'Gas Used', 'Block Hash'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {blocks.map(b => (
                    <tr key={b.number} style={{ cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <td style={tdStyle}>
                        <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '0.2rem 0.6rem', borderRadius: 6, fontWeight: 700, fontSize: '0.82rem' }}>#{b.number}</span>
                      </td>
                      <td style={{ ...tdStyle, color: '#64748b' }}>{timeAgo(b.timestamp)}</td>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 600, color: b.txCount > 0 ? '#15803d' : '#94a3b8' }}>{b.txCount}</span>
                      </td>
                      <td style={{ ...tdStyle, color: '#64748b' }}>{b.gasUsed.toLocaleString()}</td>
                      <td style={tdStyle}>
                        <code style={{ fontSize: '0.75rem', color: '#7c3aed' }}>{shortHash(b.hash, 18)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Block transactions inline */}
              {blocks.filter(b => b.txCount > 0).map(b => (
                <div key={`txs-${b.number}`} style={{ borderTop: '2px solid #f1f5f9', padding: '0.5rem 1.25rem 1rem' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1d4ed8', marginBottom: '0.5rem' }}>Block #{b.number} — Transactions</div>
                  {b.transactions.map(tx => (
                    <div key={tx.hash} onClick={() => loadTx(tx.hash)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0.5rem', borderRadius: 6, cursor: 'pointer', marginBottom: '0.25rem' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f1f5f9')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <TypeBadge type={tx.type} />
                      <code style={{ fontSize: '0.75rem', color: '#7c3aed', flex: 1 }}>{shortHash(tx.hash)}</code>
                      <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{tx.contract}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ padding: '0.75rem 1.25rem', display: 'flex', gap: '0.5rem', borderTop: '1px solid #e2e8f0' }}>
                <button onClick={() => setBlockPage(p => Math.max(1, p - 1))} disabled={blockPage === 1}
                  style={{ padding: '0.4rem 1rem', borderRadius: 6, border: '1px solid #e2e8f0', cursor: 'pointer', background: '#fff', fontSize: '0.82rem', opacity: blockPage === 1 ? 0.4 : 1 }}>
                  ← Newer
                </button>
                <span style={{ padding: '0.4rem 0.75rem', fontSize: '0.82rem', color: '#64748b' }}>Page {blockPage}</span>
                <button onClick={() => setBlockPage(p => p + 1)}
                  style={{ padding: '0.4rem 1rem', borderRadius: 6, border: '1px solid #e2e8f0', cursor: 'pointer', background: '#fff', fontSize: '0.82rem' }}>
                  Older →
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Transactions Tab ── */}
      {view === 'transactions' && (
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#334155', flex: 1 }}>📋 Transactions ({filteredTxns.length})</h3>
            {(['all', 'VC', 'DID', 'deploy'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ padding: '0.3rem 0.75rem', borderRadius: 20, border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, background: filter === f ? '#1a56db' : '#fff', color: filter === f ? '#fff' : '#64748b' }}>
                {f === 'all' ? 'All' : f === 'VC' ? '📄 VC' : f === 'DID' ? '🔑 DID' : '🚀 Deploy'}
              </button>
            ))}
          </div>
          {loading ? <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading transactions…</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['TX Hash', 'Block', 'Age', 'Type', 'Contract', 'Credential / DID', 'Gas'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredTxns.length === 0 && (
                    <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>No transactions found</td></tr>
                  )}
                  {filteredTxns.map(tx => (
                    <tr key={tx.hash} onClick={() => loadTx(tx.hash)}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}>
                      <td style={tdStyle}>
                        <code style={{ fontSize: '0.75rem', color: '#7c3aed', fontWeight: 600 }}>{shortHash(tx.hash)}</code>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '0.15rem 0.5rem', borderRadius: 5, fontSize: '0.75rem', fontWeight: 700 }}>#{tx.blockNumber}</span>
                      </td>
                      <td style={{ ...tdStyle, color: '#64748b', whiteSpace: 'nowrap' }}>{timeAgo(tx.timestamp)}</td>
                      <td style={tdStyle}><TypeBadge type={tx.type} /></td>
                      <td style={{ ...tdStyle, color: '#475569', fontSize: '0.78rem' }}>{tx.contract}</td>
                      <td style={{ ...tdStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {tx.credential ? (
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.78rem', color: '#15803d' }}>{tx.credential.credential_type}</div>
                            <div style={{ fontSize: '0.7rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.credential.holder_name || tx.credential.holder_did}</div>
                          </div>
                        ) : tx.type === 'DID' ? (
                          <span style={{ fontSize: '0.75rem', color: '#1d4ed8' }}>DID Registration</span>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>—</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, color: '#64748b', whiteSpace: 'nowrap' }}>{tx.gas.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Transaction Detail ── */}
      {view === 'tx' && selectedTx && (
        <div>
          <button onClick={() => setView('transactions')}
            style={{ marginBottom: '1rem', padding: '0.4rem 1rem', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem', color: '#475569' }}>
            ← Back to Transactions
          </button>
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
            <div style={{ padding: '1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <TypeBadge type={selectedTx.type} />
              <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#334155', wordBreak: 'break-all' }}>
                {selectedTx.hash}
              </h3>
              <span style={{ background: selectedTx.status === 'success' ? '#dcfce7' : '#fee2e2', color: selectedTx.status === 'success' ? '#15803d' : '#dc2626', padding: '0.2rem 0.7rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {selectedTx.status === 'success' ? '✓ Success' : '✗ Failed'}
              </span>
            </div>
            <div style={{ padding: '1.25rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div>
                <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Transaction Details</h4>
                {[
                  ['Block', `#${selectedTx.blockNumber}`],
                  ['Contract', selectedTx.contract],
                  ['From', shortHash(selectedTx.from, 20)],
                  ['To', selectedTx.to ? shortHash(selectedTx.to, 20) : '(contract deploy)'],
                  ['Gas Limit', selectedTx.gas.toLocaleString()],
                  ['Gas Used', selectedTx.gasUsed?.toLocaleString() || '—'],
                ].map(([k, v]) => (
                  <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.84rem' }}>
                    <span style={{ color: '#64748b' }}>{k}</span>
                    <span style={{ fontWeight: 600, color: '#1e293b' }}>{v}</span>
                  </div>
                ))}
              </div>
              <div>
                {selectedTx.credential && (
                  <>
                    <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>📄 Verifiable Credential</h4>
                    {[
                      ['Type', selectedTx.credential.credential_type],
                      ['Issued At', new Date(selectedTx.credential.issued_at).toLocaleString()],
                      ['Issuer DID', shortHash(selectedTx.credential.issuer_did || '', 22)],
                      ['Holder DID', shortHash(selectedTx.credential.holder_did || '', 22)],
                    ].map(([k, v]) => (
                      <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.84rem' }}>
                        <span style={{ color: '#64748b' }}>{k}</span>
                        <span style={{ fontWeight: 600, color: '#15803d' }}>{v}</span>
                      </div>
                    ))}
                  </>
                )}
                {selectedTx.did && (
                  <>
                    <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🔑 DID</h4>
                    <div style={{ background: '#f8fafc', borderRadius: 8, padding: '0.75rem', fontSize: '0.82rem', wordBreak: 'break-all', color: '#1d4ed8' }}>
                      {selectedTx.did.did_string}
                    </div>
                  </>
                )}
                {!selectedTx.credential && !selectedTx.did && (
                  <div style={{ background: '#f8fafc', borderRadius: 8, padding: '1rem', fontSize: '0.82rem', color: '#64748b', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                      {selectedTx.type === 'deploy' ? '🚀' : '📦'}
                    </div>
                    {selectedTx.type === 'deploy' ? 'Contract deployment transaction' : 'On-chain transaction'}
                  </div>
                )}
              </div>
            </div>
            {/* Input data */}
            <div style={{ padding: '0 1.25rem 1.25rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Input Data</h4>
              <div style={{ background: '#0f172a', borderRadius: 8, padding: '0.75rem 1rem', overflowX: 'auto' }}>
                <code style={{ fontSize: '0.7rem', color: '#94a3b8', wordBreak: 'break-all', lineHeight: 1.6 }}>
                  {selectedTx.input && selectedTx.input.length > 300 ? selectedTx.input.slice(0, 300) + '…' : (selectedTx.input || '0x')}
                </code>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
