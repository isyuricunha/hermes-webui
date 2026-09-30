import type Database from 'better-sqlite3';

/**
 * Images the WebUI sent with a message. Hermes stores image parts as the
 * text "[screenshot]", so without this the picture is gone after a reload.
 * Grouped per send (`sent_at`), ordered by `position` within the message.
 */

export interface StoredImageMeta {
  id: number;
  sent_at: number;
  position: number;
  mime: string;
}

const DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/;

export class MessageImageStore {
  constructor(private readonly db: Database.Database) {}

  /** Saves the data-URL images of one sent message; returns how many were kept. */
  saveSend(sessionId: string, dataUrls: string[], sentAt = Date.now()): number {
    const insert = this.db.prepare(
      'INSERT INTO message_images (session_id, sent_at, position, mime, data) VALUES (?, ?, ?, ?, ?)',
    );
    let saved = 0;
    const run = this.db.transaction(() => {
      dataUrls.forEach((url, position) => {
        const match = DATA_URL.exec(url);
        if (match === null) return;
        insert.run(sessionId, sentAt, position, match[1], Buffer.from(match[2] ?? '', 'base64'));
        saved += 1;
      });
    });
    run();
    return saved;
  }

  list(sessionId: string): StoredImageMeta[] {
    return this.db
      .prepare('SELECT id, sent_at, position, mime FROM message_images WHERE session_id = ? ORDER BY sent_at, position')
      .all(sessionId) as StoredImageMeta[];
  }

  get(id: number): { mime: string; data: Buffer } | undefined {
    return this.db.prepare('SELECT mime, data FROM message_images WHERE id = ?').get(id) as
      | { mime: string; data: Buffer }
      | undefined;
  }

  deleteSession(sessionId: string): void {
    this.db.prepare('DELETE FROM message_images WHERE session_id = ?').run(sessionId);
  }
}
