// DESIGN S6: a group's "form by" date. Once it has passed and the group has not formed, everyone on the roster is reminded that
// coins reserved for it in Dash-Qt stay set aside until they release them.
import type { GroupView } from './group.ts';
import { isUnderway, type Stage } from './stage.ts';

export const FORM_BY_PASSED = 'The form-by date has passed. If you reserved coins in Dash-Qt, release them.';

/** The day a group aims to form by, in the reader's own date format. */
export const formByDate = (formBy: number) => new Date(formBy * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export const formByPassed = (v: GroupView, now = Date.now()) => !!v.group.formBy && now > v.group.formBy * 1000;

/** Whether `me` gets the release-your-coins note: on the roster, past the date, and the group not formed. */
export function formByNoteFor(v: GroupView, me: string | null, stage: Stage, now = Date.now()): boolean {
  return !!me && v.group.roster.some((r) => r.id === me) && formByPassed(v, now) && !isUnderway(stage);
}
