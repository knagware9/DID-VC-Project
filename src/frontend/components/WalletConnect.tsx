import React, { useEffect, useState } from 'react';
import './WalletConnect.css';

interface WalletConnectProps {
  walletAddress: string | null;
  isConnected: boolean;
  onConnect: (address: string) => void;
  onDisconnect: () => void;
}

const WalletConnect: React.FC<WalletConnectProps> = ({
  walletAddress,
  isConnected,
  onConnect,
  onDisconnect,
}) => {
  const [balance, setBalance] = useState<string>('0');

  useEffect(() => {
    if (isConnected && walletAddress) {
      fetchBalance();
    }
  }, [isConnected, walletAddress]);

  const fetchBalance = async () => {
    if (!walletAddress) return;
    try {
      const response = await fetch(`/api/polygon/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress }),
      });
      const data = await response.json();
      if (data.success) {
        setBalance(parseFloat(data.balance).toFixed(4));
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    }
  };

  const connectWallet = async () => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const accounts = await (window as any).ethereum.request({
          method: 'eth_requestAccounts',
        });
        if (accounts.length > 0) {
          onConnect(accounts[0]);
        }
      } catch (error) {
        console.error('Failed to connect wallet:', error);
        alert('Failed to connect wallet. Please make sure MetaMask is installed.');
      }
    } else {
      alert('MetaMask is not installed. Please install MetaMask to connect your wallet.');
    }
  };

  const disconnectWallet = () => {
    onDisconnect();
    setBalance('0');
  };

  return (
    <div className="wallet-connect">
      {isConnected && walletAddress ? (
        <div className="wallet-info">
          <div className="wallet-address">
            {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
          </div>
          <div className="wallet-balance">{balance} MATIC</div>
          <button className="btn btn-secondary btn-sm" onClick={disconnectWallet}>
            Disconnect
          </button>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={connectWallet}>
          Connect Wallet
        </button>
      )}
    </div>
  );
};

export default WalletConnect;

