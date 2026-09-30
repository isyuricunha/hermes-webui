import { describe, expect, it } from 'vitest';
import {
  findMediaTags,
  isDeliverableMediaPath,
  mediaKindOf,
  rewriteMediaTags,
  stripMediaTags,
} from '@hermes-webui/shared';

describe('MEDIA tags', () => {
  it('finds bare tags on their own lines, as Telegram replies carry them', () => {
    const text = 'Aqui estão:\n\nMEDIA:/home/u/ella/images/docs-1440.png\n\nMEDIA:/home/u/ella/images/login-375.png\n\nFim.';
    expect(findMediaTags(text).map((tag) => tag.path)).toEqual([
      '/home/u/ella/images/docs-1440.png',
      '/home/u/ella/images/login-375.png',
    ]);
  });

  it('keeps sentence punctuation and closed emphasis out of the path', () => {
    expect(findMediaTags('See MEDIA:/tmp/a.png.').map((tag) => tag.path)).toEqual(['/tmp/a.png']);
    // A line-ending "." would dangle under a block embed; mid-sentence punctuation stays.
    expect(rewriteMediaTags('See MEDIA:/tmp/a.png.')).toBe('See ![media](hermes-media:%2Ftmp%2Fa.png)');
    expect(rewriteMediaTags('MEDIA:/tmp/a.png, e mais')).toBe('![media](hermes-media:%2Ftmp%2Fa.png), e mais');
    expect(rewriteMediaTags('**MEDIA:/tmp/a.png**')).toBe('![media](hermes-media:%2Ftmp%2Fa.png)');
    expect(findMediaTags('(MEDIA:/tmp/b.pdf)').map((tag) => tag.path)).toEqual(['/tmp/b.pdf']);
  });

  it('accepts quoted paths with spaces', () => {
    expect(findMediaTags('MEDIA:"/tmp/my file.png"').map((tag) => tag.path)).toEqual(['/tmp/my file.png']);
    expect(findMediaTags('MEDIA:`/tmp/my file.png`').map((tag) => tag.path)).toEqual(['/tmp/my file.png']);
  });

  it('ignores examples inside code', () => {
    expect(findMediaTags('Use `MEDIA:/tmp/a.png` to send.')).toEqual([]);
    expect(findMediaTags('```\nMEDIA:/tmp/a.png\n```\nMEDIA:/tmp/b.png')).toEqual([
      expect.objectContaining({ path: '/tmp/b.png' }),
    ]);
    expect(findMediaTags('MEDIA:relative/a.png')).toEqual([]);
  });

  it('rewrites parentheses so markdown destinations stay balanced', () => {
    expect(rewriteMediaTags('MEDIA:/tmp/a(1).png')).toBe('![media](hermes-media:%2Ftmp%2Fa%281%29.png)');
  });

  it('drops delivery directives only when a tag was delivered, and strips tags for copy/speech', () => {
    expect(rewriteMediaTags('[[audio_as_voice]]\nMEDIA:/tmp/v.ogg')).toBe('\n![media](hermes-media:%2Ftmp%2Fv.ogg)');
    expect(rewriteMediaTags('literal [[as_document]]')).toBe('literal [[as_document]]');
    expect(stripMediaTags('Olha:\n\nMEDIA:/tmp/a.png\n\n\nFim')).toBe('Olha:\n\nFim');
  });
});

describe('deliverable media paths', () => {
  it('classifies by extension', () => {
    expect(mediaKindOf('/a/b.PNG')).toBe('image');
    expect(mediaKindOf('/a/b.ogg')).toBe('audio');
    expect(mediaKindOf('/a/b.mp4')).toBe('video');
    expect(mediaKindOf('/a/b.pdf')).toBe('file');
    expect(mediaKindOf('/a/b.json')).toBeNull();
    expect(mediaKindOf('/a/.png')).toBeNull();
  });

  it('refuses relative paths, traversal, credential folders and system roots', () => {
    expect(isDeliverableMediaPath('/home/u/ella/images/a.png')).toBe(true);
    expect(isDeliverableMediaPath('~/Pictures/a.jpg')).toBe(true);
    expect(isDeliverableMediaPath('images/a.png')).toBe(false);
    expect(isDeliverableMediaPath('/home/u/../../etc/a.png')).toBe(false);
    expect(isDeliverableMediaPath('/home/u/.ssh/id_rsa')).toBe(false);
    expect(isDeliverableMediaPath('/home/u/.ssh/key.png')).toBe(false);
    expect(isDeliverableMediaPath('/home/u/.hermes/mcp-tokens/x.txt')).toBe(false);
    expect(isDeliverableMediaPath('/etc/passwd.txt')).toBe(false);
    expect(isDeliverableMediaPath('/home/u/.env')).toBe(false);
    expect(isDeliverableMediaPath('/home/u/config.yaml')).toBe(false);
  });
});
