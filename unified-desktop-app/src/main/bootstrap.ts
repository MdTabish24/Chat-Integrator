/**
 * Bootstrap file - loads crypto polyfill BEFORE any other imports
 * This is necessary because Baileys checks for globalThis.crypto at module load time
 */

// Polyfill globalThis.crypto for Node.js (required by Baileys)
import { webcrypto } from 'node:crypto';

// Must be set before any Baileys imports
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = webcrypto;
}

// Now import and run the main application
import('./main.js');
