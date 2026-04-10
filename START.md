# Quick Start Guide

## Running the Full Stack Application

### Option 1: Run Both Server and Frontend (Recommended)

**Terminal 1 - Backend Server:**
```bash
npm run dev:server
```
Server runs on: http://localhost:3001

**Terminal 2 - Frontend:**
```bash
npm run dev:frontend
```
Frontend runs on: http://localhost:3000

Then open http://localhost:3000 in your browser.

### Option 2: Build and Run Production

**Build everything:**
```bash
npm run build
npm run build:frontend
```

**Run server:**
```bash
npm run start:server
```

**Serve frontend** (use any static file server):
```bash
# Using Python
cd dist/frontend && python -m http.server 3000

# Using Node.js http-server
npx http-server dist/frontend -p 3000
```

## First Time Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start backend server:**
   ```bash
   npm run dev:server
   ```

3. **Start frontend (new terminal):**
   ```bash
   npm run dev:frontend
   ```

4. **Open browser:**
   Navigate to http://localhost:3000

## Using the Application

### 1. Connect Wallet (Optional)
- Install MetaMask browser extension
- Connect to Polygon Mumbai testnet
- Click "Connect Wallet" in the navbar

### 2. Create an Issuer
- Go to "Issuer" page
- Click "Create Issuer"
- Fill in credential details
- Click "Issue Credential"

### 3. Store as Holder
- Go to "Holder" page
- Click "Create Holder"
- Store the credential (paste JSON or use API)
- Create a presentation

### 4. Verify as Verifier
- Go to "Verifier" page
- Click "Create Verifier"
- Paste presentation/credential JSON
- Click "Verify"

## Troubleshooting

**Port already in use:**
- Change frontend port in `vite.config.ts`
- Change backend port via `PORT` environment variable

**Build errors:**
- Delete `node_modules` and `dist` folders
- Run `npm install` again

**MetaMask connection:**
- Ensure MetaMask is installed and unlocked
- Connect to Polygon Mumbai testnet
- Check browser console for errors

