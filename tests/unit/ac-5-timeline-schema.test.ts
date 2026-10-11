import { describe, it, expect } from 'vitest';
import {
  addNoteInputSchema,
  updateNoteInputSchema,
  deleteNoteInputSchema,
  listTimelineInputSchema,
} from '@/server/timeline/schema';

describe('AC-5: Timeline and note input validation schemas', () => {
  const validClientId = '018f0000-0000-7000-8000-000000000001';
  const validNoteId = '018f0000-0000-7000-8000-000000000002';

  it('AC-5: addNoteInputSchema accepts valid note with 1 character', () => {
    const parsed = addNoteInputSchema.safeParse({
      clientId: validClientId,
      body: 'a',
    });
    expect(parsed.success).toBe(true);
  });

  it('AC-5: addNoteInputSchema accepts note with 5,000 characters and preserves line breaks', () => {
    const longBody = 'A'.repeat(2499) + '\n\n' + 'B'.repeat(2499);
    expect(longBody.length).toBe(5000);

    const parsed = addNoteInputSchema.safeParse({
      clientId: validClientId,
      body: longBody,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.body).toContain('\n\n');
      expect(parsed.data.body.length).toBe(5000);
    }
  });

  it('AC-5: addNoteInputSchema rejects empty body (0 characters) and whitespace-only body', () => {
    const emptyResult = addNoteInputSchema.safeParse({
      clientId: validClientId,
      body: '',
    });
    expect(emptyResult.success).toBe(false);

    const whitespaceResult = addNoteInputSchema.safeParse({
      clientId: validClientId,
      body: '   \n\t  ',
    });
    expect(whitespaceResult.success).toBe(false);
  });

  it('AC-5: addNoteInputSchema rejects body exceeding 5,000 characters (5,001 chars)', () => {
    const oversizedBody = 'x'.repeat(5001);
    const result = addNoteInputSchema.safeParse({
      clientId: validClientId,
      body: oversizedBody,
    });
    expect(result.success).toBe(false);
  });

  it('AC-5: addNoteInputSchema rejects invalid client UUID and unexpected fields', () => {
    const invalidId = addNoteInputSchema.safeParse({
      clientId: 'not-a-uuid',
      body: 'Valid body',
    });
    expect(invalidId.success).toBe(false);

    const unexpectedField = addNoteInputSchema.safeParse({
      clientId: validClientId,
      body: 'Valid body',
      maliciousField: 'exploit',
    });
    expect(unexpectedField.success).toBe(false);
  });

  it('AC-5: updateNoteInputSchema validates noteId, clientId, and body boundaries', () => {
    const valid = updateNoteInputSchema.safeParse({
      clientId: validClientId,
      noteId: validNoteId,
      body: 'Updated note text',
    });
    expect(valid.success).toBe(true);

    const empty = updateNoteInputSchema.safeParse({
      clientId: validClientId,
      noteId: validNoteId,
      body: '',
    });
    expect(empty.success).toBe(false);

    const tooLong = updateNoteInputSchema.safeParse({
      clientId: validClientId,
      noteId: validNoteId,
      body: 'y'.repeat(5001),
    });
    expect(tooLong.success).toBe(false);
  });

  it('AC-5: deleteNoteInputSchema validates required UUID fields', () => {
    const valid = deleteNoteInputSchema.safeParse({
      clientId: validClientId,
      noteId: validNoteId,
    });
    expect(valid.success).toBe(true);

    const missingNote = deleteNoteInputSchema.safeParse({
      clientId: validClientId,
    });
    expect(missingNote.success).toBe(false);
  });

  it('AC-5: listTimelineInputSchema validates clientId and optional cursor', () => {
    const withoutCursor = listTimelineInputSchema.safeParse({
      clientId: validClientId,
    });
    expect(withoutCursor.success).toBe(true);

    const withCursor = listTimelineInputSchema.safeParse({
      clientId: validClientId,
      cursor: 'opaque-base64url-token',
    });
    expect(withCursor.success).toBe(true);

    const invalidUuid = listTimelineInputSchema.safeParse({
      clientId: 'abc',
    });
    expect(invalidUuid.success).toBe(false);
  });
});
