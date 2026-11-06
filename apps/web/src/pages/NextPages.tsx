// Routes whose features arrive in later delivery steps (DESIGN.md section 11). Each says plainly what it will do.
import { Link, useParams } from 'react-router-dom';
import { NextUp } from '../ui/states.tsx';

const short = (id?: string) => (id ? `${id.slice(0, 6)}…${id.slice(-4)}` : '');

export function NewGroupPage() {
  return (
    <NextUp
      title="Open a group"
      lede="Start a masternode with others: as its operator, with your terms, or as a member who picks an operator from the directory."
      will={[
        'Choose operator-led or member-led, the operator’s reward and the early-exit terms.',
        'Set a “form by” date and a group chat link (Discord, Yappr, Telegram or Matrix).',
        'Invite people who are looking; every amount is checked as you type, so the group can always add up to exactly 1000 DASH.',
      ]}
      meanwhile={
        <p>
          Make your <Link to="/me">profile</Link> now so people can recognise you when the group opens.
        </p>
      }
    />
  );
}

export function GroupPage() {
  const { id } = useParams();
  return (
    <NextUp
      title={`Group ${short(id)}`}
      lede="Each group gets one page: its cairn of shares, who is in, the terms, the operator, and one clear next step for you."
      will={['Request a seat with an amount and a short note, or withdraw it before the terms are locked.', 'See the roster both sides confirmed, the terms, and who coordinates.', 'Approve the locked terms; your approval is what every later check compares against.']}
    />
  );
}

export function GroupFormPage() {
  const { id } = useParams();
  return (
    <NextUp
      title="Form the masternode"
      lede={`The step-by-step guide through Dash Core’s “Shared Masternode” wizard for group ${short(id)}.`}
      will={['A setup sheet for the coordinator: what to type on each wizard page, with copy buttons.', 'A message checker for everyone: paste a Dash Core session message and see whether it matches what you approved.', 'Link the registration once it is broadcast; Cairn verifies it against every approval.']}
      meanwhile={
        <p>
          The <Link to="/check">message checker</Link> will also work on its own, without an account.
        </p>
      }
    />
  );
}

export function GroupLivePage() {
  const { id } = useParams();
  return (
    <NextUp
      title="Live masternode"
      lede={`How group ${short(id)}’s masternode is doing, read from the chain.`}
      will={['Status from the verified masternode list, your share of the rewards and when the early period ends.', 'How-tos: keep a standby exit ready, change your reward address, replace the operator, leave.', 'Refill: if someone leaves, reopen the group with the same terms for just their amount.']}
    />
  );
}

export function OperatorPage() {
  const { id } = useParams();
  return (
    <NextUp
      title={`Operator ${short(id)}`}
      lede="An operator’s terms, regions and capacity, with a track record computed from the chain."
      will={['Groups this operator runs that are live and verified, and their current state in the masternode list.', 'Masternodes they say they operate, marked as claimed until the chain confirms them.']}
    />
  );
}

export function CheckPage() {
  return (
    <NextUp
      title="Check a Dash Core message"
      lede="Paste any shared-masternode session message from Dash Core and see, in your browser, which stage it is, whether it matches the terms you approved, and whether it is safe to continue."
      will={['Works without an account or a group.', 'The message never leaves your browser.', 'Every share, the operator, the reward, the service address and the exit terms are compared one by one.']}
    />
  );
}
