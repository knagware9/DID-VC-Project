#!/usr/bin/env node
/**
 * generate-static-nodes.mjs
 * Reads besu/network/keys/node{1..5}/key.pub files and writes
 * besu/network/static-nodes.json with enode URLs.
 *
 * Uses static IPs from the besu-network Docker subnet (172.16.239.11-15)
 * because Besu's static-nodes parser requires IP addresses, not hostnames.
 * These IPs must match the ipv4_address assignments in docker-compose.yml.
 *
 * Usage: node scripts/generate-static-nodes.mjs <network-dir>
 *   e.g: node scripts/generate-static-nodes.mjs ./besu/network
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const networkDir = resolve(process.argv[2] || '.');
const keysDir = join(networkDir, 'keys');

// Static IPs assigned to each node in docker-compose.yml (besu-network subnet 172.16.239.0/24)
// node1 → .11, node2 → .12, ..., node5 → .15
const NODE_IPS = [
  '172.16.239.11',
  '172.16.239.12',
  '172.16.239.13',
  '172.16.239.14',
  '172.16.239.15',
];

// Validate keysDir exists before readdirSync
if (!statSync(keysDir, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`[generate-static-nodes] keys directory not found: ${keysDir}`);
  process.exit(1);
}

// List only directories (skip files), sort for deterministic ordering
const keyDirs = readdirSync(keysDir)
  .filter(entry => statSync(join(keysDir, entry)).isDirectory())
  .sort();

if (keyDirs.length === 0) {
  console.error(`[generate-static-nodes] No key directories found in ${keysDir}`);
  process.exit(1);
}

if (keyDirs.length !== NODE_IPS.length) {
  console.error(`[generate-static-nodes] Expected ${NODE_IPS.length} key directories, found ${keyDirs.length}`);
  process.exit(1);
}

const P2P_PORT = 30303;

const enodes = keyDirs.map((dir, index) => {
  const pubKeyPath = join(keysDir, dir, 'key.pub');
  let pubKey;
  try {
    pubKey = readFileSync(pubKeyPath, 'utf8').trim().replace(/^0x/, '');
  } catch (err) {
    console.error(`[generate-static-nodes] Cannot read ${pubKeyPath}: ${err.message}`);
    process.exit(1);
  }
  if (!pubKey || !/^[0-9a-fA-F]{128}$/.test(pubKey)) {
    console.error(
      `[generate-static-nodes] Invalid pubkey in ${pubKeyPath}: ` +
      `expected 128 hex chars, got ${pubKey.length} chars`
    );
    process.exit(1);
  }
  const ip = NODE_IPS[index];
  return `enode://${pubKey}@${ip}:${P2P_PORT}`;
});

const outputPath = join(networkDir, 'static-nodes.json');
writeFileSync(outputPath, JSON.stringify(enodes, null, 2) + '\n');

console.log(`[generate-static-nodes] Written ${enodes.length} enodes to ${outputPath}`);
enodes.forEach(e => console.log(`  ${e.substring(0, 80)}...`));
