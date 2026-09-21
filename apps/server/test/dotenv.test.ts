import { describe, expect, it } from 'vitest';
import { parseEnvFile } from '../src/dotenv';

describe('parseEnvFile', () => {
  it('parses key=value pairs and ignores comments and blanks', () => {
    const parsed = parseEnvFile(
      [
        '# comment',
        '',
        'HERMES_BASE_URL=http://127.0.0.1:8642',
        'PORT=8789',
        'QUOTED="value with spaces"',
        "SINGLE='single'",
        'MALFORMED_LINE',
        '=no-key',
      ].join('\n'),
    );
    expect(parsed).toEqual({
      HERMES_BASE_URL: 'http://127.0.0.1:8642',
      PORT: '8789',
      QUOTED: 'value with spaces',
      SINGLE: 'single',
    });
  });
});
