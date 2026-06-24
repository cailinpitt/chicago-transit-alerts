import { describe, expect, it } from 'vitest';
import { documentLinkTag, publicationLinkTag } from '../../scripts/prerender-events.js';

const DOCS = {
  '3moyslkcfq32v': 'at://did:plc:alerts/site.standard.document/3moyslkcfq32v',
};
const PUBLICATION = 'at://did:plc:alerts/site.standard.publication/self';

describe('standard.site document link tag', () => {
  it('emits the document tag on the canonical page when a record exists', () => {
    const tag = documentLinkTag('3moyslkcfq32v', 'canonical', DOCS);
    expect(tag).toContain('rel="site.standard.document"');
    expect(tag).toContain('href="at://did:plc:alerts/site.standard.document/3moyslkcfq32v"');
  });

  it('omits the document tag on the /resolved variant (path would not match)', () => {
    expect(documentLinkTag('3moyslkcfq32v', 'resolved', DOCS)).toBe('');
  });

  it('omits the document tag when no record exists for the id', () => {
    expect(documentLinkTag('unknownid', 'canonical', DOCS)).toBe('');
  });

  it('emits the publication tag only when the canonical event has a document', () => {
    expect(publicationLinkTag('3moyslkcfq32v', 'canonical', DOCS, PUBLICATION)).toContain(
      'rel="site.standard.publication"',
    );
    expect(publicationLinkTag('unknownid', 'canonical', DOCS, PUBLICATION)).toBe('');
    expect(publicationLinkTag('3moyslkcfq32v', 'resolved', DOCS, PUBLICATION)).toBe('');
  });
});
