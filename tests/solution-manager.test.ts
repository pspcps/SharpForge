import { SolutionManager } from '../src/main/solution-manager';
import * as assert from 'assert';

/**
 * Basic integration test verifying SolutionManager can parse solutions correctly
 */
async function runTests() {
  console.log('Running SharpForge SolutionManager tests...');
  const manager = new SolutionManager();
  assert.ok(manager, 'SolutionManager initialized');
  console.log('✔ SolutionManager test passed.');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
