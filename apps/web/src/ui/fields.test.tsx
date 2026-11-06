// @vitest-environment happy-dom
// The early-exit field: "Other" stays open while the organizer types, whatever number they pass through on the way.
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { click, render, type } from '../test/render.tsx';
import { ExitTermsField } from './fields.tsx';

let seen = 0;
function Harness({ start = 0 }: { start?: number }) {
  const [period, setPeriod] = useState(start);
  const [penalty, setPenalty] = useState('');
  seen = period;
  return <ExitTermsField period={period} onPeriod={setPeriod} penalty={penalty} onPenalty={setPenalty} problem={null} rewardBps={1000} />;
}

const radio = (el: HTMLElement, label: string) => [...el.querySelectorAll('label')].find((l) => l.textContent?.trim() === label)!.querySelector('input')!;
const days = (el: HTMLElement) => el.querySelector<HTMLInputElement>('[data-testid="period-days"]');

describe('the early-exit field', () => {
  it('keeps the custom days field while it is cleared or passes a preset’s number', async () => {
    const r = await render(<Harness />);
    await click(radio(r.el, 'Other'));
    expect(days(r.el)!.value).toBe('30');
    expect(seen).toBe(30 * 576);

    await type(days(r.el)!, '');
    expect(days(r.el)).not.toBeNull();
    expect(radio(r.el, 'No early period').checked).toBe(false);
    expect(Number.isNaN(seen)).toBe(true);
    expect(r.el.textContent).toContain('Enter the number of days, from 1 to 730.');

    await type(days(r.el)!, '9');
    await type(days(r.el)!, '91');
    expect(days(r.el)!.value).toBe('91');
    expect(radio(r.el, '3 months').checked).toBe(false);
    expect(radio(r.el, 'Other').checked).toBe(true);
    expect(seen).toBe(91 * 576);

    await type(days(r.el)!, '365');
    expect(days(r.el)!.value).toBe('365');
    expect(radio(r.el, '1 year').checked).toBe(false);

    await type(days(r.el)!, '731');
    expect(r.el.textContent).toContain('At most 730 days');
    await r.unmount();
  });

  it('picks Dash-Qt’s preset blocks and opens an existing custom period as Other', async () => {
    const r = await render(<Harness />);
    await click(radio(r.el, '3 months'));
    expect(seen).toBe(52_560);
    expect(days(r.el)).toBeNull();
    await r.unmount();

    const legacy = await render(<Harness start={52_416} />);
    expect(radio(legacy.el, 'Other').checked).toBe(true);
    expect(days(legacy.el)!.value).toBe('91');
    await legacy.unmount();
  });
});
