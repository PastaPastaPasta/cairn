// Errors in plain words (F-014): the SDK's and nodes' own text goes behind a disclosure; Cairn's own messages pass through.
import { describe, expect, it, vi } from 'vitest';
import { plainError } from './errors.ts';
import { StaleWrite, UnconfirmedWrite } from './write.ts';

vi.mock('./platform.ts', () => ({ getCairnDoc: vi.fn(), queryCairn: vi.fn() }));

describe('plain errors', () => {
  it('turns a refused stale write into a reload hint, keeping Platform’s text as detail', () => {
    const raw = 'Failed to wait for state transition result: state transition broadcast error: Document HowJtbb has invalid revision Some(9). The desired revision is 9';
    const p = plainError(new Error(raw));
    expect(p.text).toMatch(/Someone changed this on Dash Platform after the page loaded it/);
    expect(p.detail).toContain('invalid revision');
  });

  it('turns transport failures and malformed ids into plain words', () => {
    const grpc = plainError(new Error(`transport error: grpc error: code: 'Internal error', message: "Failed to call gRPC service: JS API error: TypeError: Failed to fetch"`));
    expect(grpc.text).toBe('Could not reach Dash Platform just now: the connection dropped or a node was too slow. Try again in a moment.');
    expect(plainError(new Error("Invalid document ID: string decoding error provided string contained invalid character 'l' at byte 7")).text).toMatch(/does not point to a Cairn record/);
    // evo-sdk throws WASM objects that are not Errors
    expect(plainError({ message: 'something deep in wasm' }).detail).toBe('something deep in wasm');
  });

  it('passes Cairn’s own messages through, and never asks to resend a write Platform accepted', () => {
    expect(plainError(new StaleWrite('the terms changed'))).toEqual({ text: 'the terms changed', detail: null });
    const accepted = plainError(new UnconfirmedWrite('transport error: connection reset', 'id'));
    expect(accepted.text).toMatch(/accepted the change, but this page could not read it back/);
  });
});
