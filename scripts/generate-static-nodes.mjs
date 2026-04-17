#!/usr/bin/env node
/**
 * generate-static-nodes.mjs
 * Reads besu/network/keys/node{1..5}/key.pub files and writes
 * besu/network/static-nodes.json with enode URLs using Docker Compose
 * service hostnames (besu-node1 … besu-node5).
 *
 * Usage: node scripts/generate-static-nodes.mjs <network-dir>
 *   e.g: node scripts/generate-static-nodes.mjs ./besu/network
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const networkDir = resolve(process.argv[2] || '.');
const keysDir = join(networkDir, 'keys');

// List only directories (skip files), sort for deterministic ordering
const keyDirs = readdirSync(keysDir)
  .filter(entry => statSync(join(keysDir, entry)).isDirectory())
  .sort();

if (keyDirs.length === 0) {
  console.error(`[generate-static-nodes] No key directories found in ${keysDir}`);
  process.exit(1);
}

const P2P_PORT = 30303;

const enodes = keyDirs.map((dir, index) => {
  const pubKeyPath = join(keysDir, dir, 'key.pub');
  // key.pub may or may not have a leading 0x — strip it
  const pubKey = readFileSync(pubKeyPath, 'utf8').trim().replace(/^0x/, '');
  const host = `besu-node${index + 1}`;
  return `enode://${pubKey}@${host}:${P2P_PORT}`;
});

const outputPath = join(networkDir, 'static-nodes.json');
writeFileSync(outputPath, JSON.stringify(enodes, null, 2) + '\n');

console.log(`[generate-static-nodes] Written ${enodes.length} enodes to ${outputPath}`);
enodes.forEach(e => console.log(`  ${e.substring(0, 80)}...`));
