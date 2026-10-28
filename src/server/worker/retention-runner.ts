import 'server-only';
import {
  executeRetentionSweep,
  type CliOptions,
  type CliExecutionResult,
} from '@/server/retention/runner';

export { executeRetentionSweep, type CliOptions, type CliExecutionResult };

/**
 * Worker retention runner execution entry point.
 */
export async function runRetentionRunner(options: CliOptions = {}): Promise<CliExecutionResult> {
  return executeRetentionSweep(options);
}
