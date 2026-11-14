export const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['completed', 'blocked'] },
    measurement: { type: 'string', enum: ['not_applicable', 'unmeasured', 'observed', 'improved', 'unchanged', 'regressed'] },
    summary: { type: 'string', minLength: 1, maxLength: 8000 },
    evidence: { type: 'string', minLength: 1, maxLength: 8000 },
    nextCheck: { type: 'string', minLength: 1, maxLength: 8000 },
  },
  required: ['status', 'measurement', 'summary', 'evidence', 'nextCheck'],
};

export class CliError extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

export function parseJSON(text) {
  try { return JSON.parse(text); }
  catch (error) {
    if (error instanceof SyntaxError) throw new CliError('Host returned malformed JSON. Update the selected CLI and retry.');
    throw error;
  }
}

export function validateReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)
    || Object.keys(report).length !== schema.required.length
    || schema.required.some(key => !Object.hasOwn(report, key))) {
    throw new CliError('Host report has an invalid structure.');
  }
  for (const [key, rule] of Object.entries(schema.properties)) {
    const value = report[key];
    if (typeof value !== 'string' || !value.trim() || value.length > (rule.maxLength ?? 32)
      || (rule.enum && !rule.enum.includes(value)) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
      throw new CliError('Host report contains an invalid field.');
    }
  }
  if (report.status === 'blocked' && !['not_applicable', 'unmeasured'].includes(report.measurement)) {
    throw new CliError('Blocked reports cannot claim verified measurements.');
  }
  return report;
}
