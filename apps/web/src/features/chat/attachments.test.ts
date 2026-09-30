import { describe, expect, it } from 'vitest';
import { buildRunInput, classifyFile, type PendingAttachment } from './attachments';

describe('classifyFile', () => {
  it('accepts the image types /v1/runs understands', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(classifyFile({ name: 'x', type, size: 1 })).toBe('image');
    }
    expect(classifyFile({ name: 'x.svg', type: 'image/svg+xml', size: 1 })).toBeNull();
  });

  it('treats code/config/text files as inlineable text', () => {
    expect(classifyFile({ name: 'compose.yml', type: '', size: 1 })).toBe('text');
    expect(classifyFile({ name: 'main.py', type: 'text/x-python', size: 1 })).toBe('text');
    expect(classifyFile({ name: 'Dockerfile', type: '', size: 1 })).toBe('text');
    expect(classifyFile({ name: 'report.pdf', type: 'application/pdf', size: 1 })).toBeNull();
  });
});

describe('buildRunInput', () => {
  const text: PendingAttachment = { id: '1', kind: 'text', name: 'notes.md', size: 5, text: 'a ``` b' };
  const image: PendingAttachment = { id: '2', kind: 'image', name: 'x.png', size: 5, dataUrl: 'data:image/png;base64,AAAA' };

  it('keeps plain text as a string', () => {
    expect(buildRunInput('hi', [])).toBe('hi');
  });

  it('inlines text files with a fence that cannot collide with their content', () => {
    const result = buildRunInput('look', [text]);
    expect(typeof result).toBe('string');
    expect(result).toContain('Attached file `notes.md`:\n````md\na ``` b\n````');
  });

  it('switches to parts when images are attached', () => {
    expect(buildRunInput('what is it?', [image])).toEqual([
      { type: 'text', text: 'what is it?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
    expect(buildRunInput('', [image])).toEqual([{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }]);
  });
});
