import { spawn } from 'child_process';
import * as path from 'path';
import { TestItem } from '../types/minirider';

/**
 * TestRunner manages test discovery, batch execution, and single-test execution
 * via the .NET test infrastructure (`dotnet test`).
 */
export class TestRunner {
  /**
   * Run all tests or a filtered subset in a solution / project
   */
  public async runTests(
    targetPath: string,
    filter?: string,
    onTestResult?: (test: Partial<TestItem>) => void
  ): Promise<{ passed: number; failed: number; total: number; durationMs: number }> {
    const args = ['test', targetPath, '--logger', 'console;verbosity=normal'];
    if (filter) {
      args.push('--filter', filter);
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const child = spawn('dotnet', args, {
        cwd: path.dirname(targetPath),
        shell: false
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', data => {
        const text = data.toString();
        stdout += text;
        this.parseLiveTestOutput(text, onTestResult);
      });

      child.stderr?.on('data', data => {
        stderr += data.toString();
      });

      child.on('close', () => {
        const durationMs = Date.now() - startTime;
        const passedMatch = stdout.match(/Passed:\s*(\d+)/i);
        const failedMatch = stdout.match(/Failed:\s*(\d+)/i);
        const totalMatch = stdout.match(/Total:\s*(\d+)/i);

        const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
        const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
        const total = totalMatch ? parseInt(totalMatch[1], 10) : (passed + failed);

        resolve({
          passed,
          failed,
          total,
          durationMs
        });
      });

      child.on('error', reject);
    });
  }

  private parseLiveTestOutput(chunk: string, onTestResult?: (test: Partial<TestItem>) => void) {
    if (!onTestResult) return;

    // Pattern: Passed!  - Failed:     0, Passed:     1, Skipped:     0, Total:     1, Duration: 14 ms - WeatherTracker.Tests.dll (net8.0)
    // Or: Passed WeatherTracker.Tests.UnitTests.UsersControllerTests.Get_ReturnsOkResult_WhenUserExists [14 ms]
    const lines = chunk.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      const passedMatch = trimmed.match(/^Passed\s+([A-Za-z0-9_.]+)\s+\[(\d+)\s*ms\]/i);
      if (passedMatch) {
        onTestResult({
          fullName: passedMatch[1],
          status: 'passed',
          durationMs: parseInt(passedMatch[2], 10)
        });
        continue;
      }

      const failedMatch = trimmed.match(/^Failed\s+([A-Za-z0-9_.]+)\s+\[(\d+)\s*ms\]/i);
      if (failedMatch) {
        onTestResult({
          fullName: failedMatch[1],
          status: 'failed',
          durationMs: parseInt(failedMatch[2], 10)
        });
      }
    }
  }
}
