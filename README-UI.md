# DID VC Project - UI & Polygon Integration

This project now includes a full-featured web UI and Polygon blockchain integration for managing Verifiable Credentials.

## Features

- ✅ **Modern React UI** with Vite
- ✅ **Express API Server** for backend functionality
- ✅ **Polygon Blockchain Integration** for credential storage
- ✅ **MetaMask Wallet Connection** for Polygon transactions
- ✅ **Three Main Portals**: Issuer, Holder, and Verifier
- ✅ **Dashboard** with network information

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Start the Backend Server

```bash
npm run dev:server
```

The server will run on `http://localhost:3001`

### 3. Start the Frontend (in a new terminal)

```bash
npm run dev:frontend
```

The frontend will run on `http://localhost:3000`

### 4. Open in Browser

Navigate to `http://localhost:3000` in your browser.

## Environment Variables (Optional)

Create a `.env` file in the root directory for Polygon configuration:

```env
POLYGON_NETWORK=mumbai
POLYGON_MUMBAI_RPC=https://rpc-mumbai.maticvigil.com
POLYGON_MAINNET_RPC=https://polygon-rpc.com
POLYGON_PRIVATE_KEY=your_private_key_here
POLYGON_CONTRACT_ADDRESS=your_contract_address_here
PORT=3001
```

## Usage

### Issuer Portal

1. Click "Create Issuer" to generate a new issuer DID
2. Fill in credential details (name, email, degree, university)
3. Select credential type
4. Click "Issue Credential" to create and store on Polygon

### Holder Portal

1. Click "Create Holder" to generate a new holder DID
2. Store credentials (paste JSON or receive from issuer)
3. Select credentials to create a presentation
4. Create full or selective disclosure presentations

### Verifier Portal

1. Click "Create Verifier" to initialize a verifier
2. Paste presentation or credential JSON
3. Click "Verify" to check validity
4. View verification results with errors and warnings

## Polygon Integration

The project integrates with Polygon blockchain for:

- **Credential Storage**: Credentials are stored on-chain (or in-memory for demo)
- **Transaction Tracking**: Each credential issuance generates a transaction hash
- **DID Resolution**: Support for Polygon-based DIDs (`did:polygon:mumbai:0x...`)
- **Wallet Connection**: Connect MetaMask wallet to interact with Polygon

### Connecting MetaMask

1. Install [MetaMask](https://metamask.io/) browser extension
2. Connect to Polygon Mumbai testnet
3. Click "Connect Wallet" in the UI
4. Approve the connection request

## Project Structure

```
did-vc-project/
├── src/
│   ├── server/           # Express API server
│   │   └── index.ts
│   ├── blockchain/       # Polygon integration
│   │   └── polygon.ts
│   ├── frontend/        # React frontend
│   │   ├── components/  # React components
│   │   ├── pages/       # Page components
│   │   ├── services/    # API services
│   │   └── main.tsx     # Entry point
│   ├── issuer/          # Issuer module
│   ├── holder/          # Holder module
│   └── verifier/        # Verifier module
├── vite.config.ts       # Vite configuration
└── package.json
```

## API Endpoints

### Issuer
- `POST /api/issuer/create` - Create new issuer
- `POST /api/issuer/:did/issue` - Issue credential

### Holder
- `POST /api/holder/create` - Create new holder
- `POST /api/holder/:did/store` - Store credential
- `GET /api/holder/:did/credentials` - Get all credentials
- `POST /api/holder/:did/presentation` - Create presentation

### Verifier
- `POST /api/verifier/create` - Create verifier
- `POST /api/verifier/:id/verify` - Verify presentation
- `POST /api/verifier/:id/verify-credential` - Verify credential

### Polygon
- `GET /api/polygon/network` - Get network info
- `POST /api/polygon/connect` - Connect wallet
- `GET /api/polygon/credential/:txHash` - Get credential by tx hash

## Building for Production

### Build Backend

```bash
npm run build
npm run start:server
```

### Build Frontend

```bash
npm run build:frontend
```

The built files will be in `dist/frontend/`

## Notes

- The current implementation uses in-memory storage for demo purposes
- For production, deploy a smart contract on Polygon for credential storage
- DID resolution is simplified - integrate with real DID resolvers for production
- Credential proofs use placeholder signatures - implement proper cryptographic signing for production

## Troubleshooting

### Port Already in Use

If port 3000 or 3001 is already in use, you can change them:
- Frontend: Edit `vite.config.ts` server.port
- Backend: Set `PORT` environment variable

### MetaMask Connection Issues

- Ensure MetaMask is installed and unlocked
- Connect to Polygon Mumbai testnet
- Check browser console for errors

### Build Errors

- Ensure all dependencies are installed: `npm install`
- Check TypeScript version compatibility
- Clear node_modules and reinstall if needed

