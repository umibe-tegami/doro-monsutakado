// Builds the REDEMPTION_CODES_SEED JSON from the code list files kept OUTSIDE
// this repository. Usage:
//   CODES_DIR=/path/to/codes node scripts/make-seed.mjs > seed.json
// Then set the file's contents as the REDEMPTION_CODES_SEED env var on Render.
// This script contains no codes itself; nothing secret is committed.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.CODES_DIR;
if (!dir) { console.error('Set CODES_DIR to the folder holding the code list files.'); process.exit(1); }
const MAP = {
  'adfree_codes.txt': 'ad_free',
  'souls300_codes.txt': 'souls300',
  'souls1000_codes.txt': 'souls1000',
  'souls2500_codes.txt': 'souls2500',
  'souls5500_codes.txt': 'souls5500',
  'souls14000_codes.txt': 'souls14000',
  'souls30000_codes.txt': 'souls30000',
};
const out = {};
for (const [file, item] of Object.entries(MAP)) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) { console.error(`missing ${p}`); process.exit(1); }
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const code = line.trim().toUpperCase();
    if (code) out[code] = item;
  }
}
console.log(JSON.stringify(out));
