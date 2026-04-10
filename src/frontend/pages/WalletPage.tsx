import React from 'react';
import WalletManager from '../components/WalletManager';
import '../App.css';

const WalletPage: React.FC = () => {
  return (
    <div>
      <div className="card">
        <h1 className="card-title">Browser Wallet</h1>
        <p style={{ marginBottom: '2rem', color: '#666' }}>
          Manage your verifiable credentials stored locally in your browser. 
          Your credentials are stored securely and never leave your device.
        </p>
      </div>

      <WalletManager />
    </div>
  );
};

export default WalletPage;

