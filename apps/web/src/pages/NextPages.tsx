// Routes whose features arrive in later delivery steps (DESIGN.md section 11). Each says plainly what it will do.
import { Link, useParams } from 'react-router-dom';
import { OperatorTrackRecord } from '../formation/TrackRecord.tsx';
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

export function OperatorPage() {
  const { id } = useParams();
  return (
    <NextUp
      title={`Operator ${short(id)}`}
      lede="An operator’s terms, regions and capacity, with a track record computed from the chain."
      will={['Groups this operator runs that are live and verified, and their current state in the masternode list.', 'Masternodes they say they operate, marked as claimed until the chain confirms them.']}
      meanwhile={id && <OperatorTrackRecord operatorId={id} />}
    />
  );
}
