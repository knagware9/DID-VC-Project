import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.19",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  paths: {
    sources: "./src/contracts",
    artifacts: "./artifacts",
    cache: "./cache",
  },
  networks: {
    hardhat: { chainId: 31337 },
    // Local dev chain (Hardhat node or Besu) — chainId auto-detected
    besu: {
      url: process.env.BESU_RPC_URL || "http://localhost:8545",
      accounts: process.env.BESU_PRIVATE_KEY ? [process.env.BESU_PRIVATE_KEY] : [],
      chainId: parseInt(process.env.BESU_CHAIN_ID || "31337"),
    },
    // Besu QBFT private network — uses EIP-1559 (londonBlock: 0 in genesis)
    // gasPrice is omitted so Hardhat uses eth_gasPrice / fee estimation automatically.
    besuPrivate: {
      url: process.env.BESU_RPC_URL || "http://localhost:8545",
      accounts: process.env.BESU_PRIVATE_KEY ? [process.env.BESU_PRIVATE_KEY] : [],
      chainId: parseInt(process.env.BESU_CHAIN_ID || "1337"),
    },
  },
  typechain: {
    outDir: "src/blockchain/typechain",
    target: "ethers-v6",
  },
};

export default config;
