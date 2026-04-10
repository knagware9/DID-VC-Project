import React, { useState, useEffect } from 'react';
import { browserWallet, WalletCredential, WalletInfo } from '../services/wallet';
import '../App.css';

interface WalletManagerProps {
  onCredentialSelect?: (credential: WalletCredential) => void;
}

const WalletManager: React.FC<WalletManagerProps> = ({ onCredentialSelect }) => {
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [credentials, setCredentials] = useState<WalletCredential[]>([]);
  const [selectedCredential, setSelectedCredential] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [showExport, setShowExport] = useState(false);
  const [exportData, setExportData] = useState('');

  useEffect(() => {
    loadWallet();
  }, []);

  useEffect(() => {
    if (searchQuery) {
      searchCredentials();
    } else {
      loadCredentials();
    }
  }, [searchQuery, filterType]);

  const loadWallet = async () => {
    const info = browserWallet.getWalletInfo();
    setWalletInfo(info);
    await loadCredentials();
  };

  const loadCredentials = async () => {
    let creds = await browserWallet.getAllCredentials();
    
    if (filterType !== 'all') {
      creds = creds.filter((c) => c.type.includes(filterType));
    }
    
    setCredentials(creds);
  };

  const searchCredentials = async () => {
    const results = await browserWallet.searchCredentials(searchQuery);
    setCredentials(results);
  };

  const handleRemoveCredential = async (credentialId: string) => {
    if (confirm('Are you sure you want to remove this credential from your wallet?')) {
      await browserWallet.removeCredential(credentialId);
      await loadCredentials();
      if (selectedCredential === credentialId) {
        setSelectedCredential(null);
      }
    }
  };

  const handleExportWallet = async () => {
    const data = await browserWallet.exportWallet();
    setExportData(data);
    setShowExport(true);
  };

  const handleImportWallet = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const text = await file.text();
        const success = await browserWallet.importWallet(text);
        if (success) {
          alert('Wallet imported successfully!');
          await loadWallet();
        } else {
          alert('Failed to import wallet. Please check the file format.');
        }
      }
    };
    input.click();
  };

  const handleDownloadExport = () => {
    const blob = new Blob([exportData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wallet_backup_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExport(false);
  };

  const getUniqueTypes = (): string[] => {
    const types = new Set<string>();
    credentials.forEach((c) => {
      c.type.forEach((t) => types.add(t));
    });
    return Array.from(types);
  };

  return (
    <div>
      {walletInfo && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <h2 className="card-title">Browser Wallet</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div>
              <strong>Wallet Address:</strong>
              <div className="credential-id" style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                {walletInfo.address}
              </div>
            </div>
            <div>
              <strong>Credentials:</strong>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#667eea', marginTop: '0.5rem' }}>
                {walletInfo.credentialCount}
              </div>
            </div>
            <div>
              <strong>Created:</strong>
              <div style={{ marginTop: '0.5rem' }}>
                {new Date(walletInfo.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={handleExportWallet}>
              Export Wallet
            </button>
            <button className="btn btn-secondary" onClick={handleImportWallet}>
              Import Wallet
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h2 className="card-title" style={{ margin: 0 }}>My Credentials ({credentials.length})</h2>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Search credentials..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ minWidth: '200px' }}
            />
            <select
              className="form-input"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              style={{ minWidth: '150px' }}
            >
              <option value="all">All Types</option>
              {getUniqueTypes().map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
        </div>

        {credentials.length === 0 ? (
          <p style={{ color: '#666', textAlign: 'center', padding: '2rem' }}>
            {searchQuery ? 'No credentials found matching your search.' : 'No credentials in wallet yet.'}
          </p>
        ) : (
          <div className="credential-list">
            {credentials.map((walletCred) => {
              const cred = walletCred.credential;
              const isSelected = selectedCredential === walletCred.id;
              return (
                <div
                  key={walletCred.id}
                  className="credential-item"
                  style={{
                    borderColor: isSelected ? '#667eea' : '#e0e0e0',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setSelectedCredential(walletCred.id);
                    if (onCredentialSelect) {
                      onCredentialSelect(walletCred);
                    }
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div style={{ flex: 1 }}>
                      <div className="credential-id">ID: {walletCred.id}</div>
                      <div style={{ marginTop: '0.5rem' }}>
                        <strong>Type:</strong> {cred.type?.join(', ')}
                      </div>
                      <div style={{ marginTop: '0.5rem' }}>
                        <strong>Issuer:</strong>{' '}
                        <span className="credential-id" style={{ fontSize: '0.9rem' }}>
                          {typeof cred.issuer === 'string' ? cred.issuer : cred.issuer.id}
                        </span>
                      </div>
                      {cred.credentialSubject && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <strong>Subject:</strong>{' '}
                          {cred.credentialSubject.name || cred.credentialSubject.id || 'N/A'}
                        </div>
                      )}
                      <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#666' }}>
                        Stored: {new Date(walletCred.storedAt).toLocaleString()}
                      </div>
                      {walletCred.tags && walletCred.tags.length > 0 && (
                        <div style={{ marginTop: '0.5rem' }}>
                          {walletCred.tags.map((tag) => (
                            <span key={tag} className="badge badge-info" style={{ marginRight: '0.5rem' }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                      {isSelected && <span className="badge badge-success">Selected</span>}
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveCredential(walletCred.id);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showExport && (
        <div className="card" style={{ marginTop: '2rem' }}>
          <h3>Wallet Export</h3>
          <p style={{ marginBottom: '1rem', color: '#666' }}>
            Save this data to backup your wallet. Keep it secure!
          </p>
          <textarea
            className="form-textarea"
            value={exportData}
            readOnly
            style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
          />
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <button className="btn btn-primary" onClick={handleDownloadExport}>
              Download JSON
            </button>
            <button className="btn btn-secondary" onClick={() => setShowExport(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WalletManager;

