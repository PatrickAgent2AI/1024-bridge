#!/usr/bin/env node

/**
 * 批量修复 postVaa 调用
 * 将旧的 postVaa() 修改为 postVaa(emitterChain, emitterAddress, sequence)
 */

const fs = require('fs');
const path = require('path');

const files = [
  'tests/unit/solana-core.test.ts',
  'tests/unit/token-bridge.test.ts',
  'tests/integration/integration.test.ts',
  'tests/e2e/cross-chain.test.ts',
];

function fixPostVaaInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  
  // Pattern 1: 直接的postVaa调用（已知vaaBuffer）
  // 在postVaa()调用前添加extractVAAEmitterInfo
  const pattern1 = /(const vaaAccount = await createVaaDataAccount\(connection, payer, vaaBuffer\);)\s*\n\s*\n\s*(const bodyHash[^;]+;)\s*\n\s*(const vaaHash[^;]+;)\s*\n\s*\n\s*(const \[postedVaaPda\] = findProgramAddress\(\s*\[\s*Buffer\.from\("PostedVAA"\),\s*vaaHash\s*\],\s*[^)]+\s*\);)\s*\n\s*\n\s*((?:try\s*\{\s*)?await program\.methods\s*\.postVaa\(\))/g;
  
  content = content.replace(pattern1, (match, vaaAccountLine, bodyHashLine, vaaHashLine, pdaLine, postVaaCall) => {
    modified = true;
    return `${vaaAccountLine}

      const { emitterChain, emitterAddress: vaaEmitterAddr, sequence } = extractVAAEmitterInfo(vaaBuffer);
      
      const [postedVaaPda] = findProgramAddress(
        [
          Buffer.from("PostedVAA"),
          Buffer.from(new Uint16Array([emitterChain]).buffer),
          vaaEmitterAddr,
          Buffer.from(new BigUint64Array([sequence]).buffer)
        ],
        program.programId
      );

      ${postVaaCall.replace('.postVaa()', '.postVaa(emitterChain, Array.from(vaaEmitterAddr), sequence)')}`;
  });
  
  if (modified) {
    fs.writeFileSync(filePath, content);
    console.log(`✓ Fixed ${filePath}`);
    return true;
  }
  
  return false;
}

let totalFixed = 0;
for (const file of files) {
  const fullPath = path.join(__dirname, file);
  if (fs.existsSync(fullPath)) {
    if (fixPostVaaInFile(fullPath)) {
      totalFixed++;
    }
  }
}

console.log(`\nTotal files fixed: ${totalFixed}`);

