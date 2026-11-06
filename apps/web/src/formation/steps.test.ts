import { COIN, type TermSheet } from '@cairn/shares';
import { describe, expect, it } from 'vitest';
import { setupSheet } from './setup.ts';
import { SETUP_PAGES, STEP_IDS, openStep, stepCopy, stepStates, type GroupProgress, type StepId } from './steps.ts';

const at = (p: Partial<GroupProgress>) => stepStates({ ready: false, started: false, linked: false, settled: false, ...p });
const row = (p: Partial<GroupProgress>) => STEP_IDS.map((id) => at(p)[id]).join(' ');

describe('the form page trail', () => {
  it('puts the group where its documents and the chain say it is', () => {
    expect(row({})).toBe('current todo todo todo todo todo todo');
    expect(row({ ready: true })).toBe('done current todo todo todo todo todo');
    // inside Dash-Qt Cairn cannot tell the round: all of them are under way
    expect(row({ ready: true, started: true })).toBe('done done in-qt in-qt in-qt in-qt todo');
    expect(row({ ready: true, started: true, linked: true })).toBe('done done done done done done current');
    expect(row({ ready: true, started: true, linked: true, settled: true })).toBe('done done done done done done done');
  });

  it('opens the current step, the round the viewer was on while in Dash-Qt, or the link once everything is done', () => {
    expect(openStep(at({ ready: true }), 'round2')).toBe('setup');
    expect(openStep(at({ ready: true, started: true }), null)).toBe('round1');
    expect(openStep(at({ ready: true, started: true }), 'round3')).toBe('round3');
    expect(openStep(at({ ready: true, started: true, linked: true }), 'round3')).toBe('link');
    expect(openStep(at({ ready: true, started: true, linked: true, settled: true }), null)).toBe('link');
  });

  it('names every step for both roles, and only the coordinator sets up and broadcasts', () => {
    for (const id of STEP_IDS) for (const role of ['coordinator', 'member'] as const) expect(stepCopy(id, role).title).toBeTruthy();
    expect(stepCopy('setup', 'coordinator').title).toBe('Set up Dash-Qt');
    expect(stepCopy('setup', 'member').title).toBe('Get ready');
    expect(stepCopy('broadcast', 'coordinator').sub).toMatch(/Press “Broadcast Registration”/);
    expect(stepCopy('broadcast', 'member').sub).toMatch(/The coordinator broadcasts/);
  });

  it('shows every page of the coordinator’s setup sheet exactly once, in Dash-Qt’s order', () => {
    const terms: TermSheet = {
      network: 'test',
      groupId: 'g',
      revision: 1,
      shares: [
        { memberId: 'a', label: 'Ana', amount: 600n * COIN },
        { memberId: 'b', label: 'Ben', amount: 400n * COIN },
      ],
      operatorPubKey: 'aa'.repeat(48),
      service: '',
      votingAddress: 'yLxbzpcXn5vgD1rupyVWM2bn5SW39PF4ns',
      votingHolderId: 'a',
      rewardBps: 1000,
      earlyPeriodBlocks: 52560,
      earlyPenalty: 5n * COIN,
      coordinatorId: 'a',
    };
    const shown = STEP_IDS.flatMap((id: StepId) => SETUP_PAGES[id] ?? []);
    expect(shown).toEqual(setupSheet(terms).map((p) => p.id));
  });
});
