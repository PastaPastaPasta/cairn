import { Link } from 'react-router-dom';
import { useApp } from '../app/context.tsx';
import { ActivationCard } from '../ui/Activation.tsx';
import { CairnStack, type Stone } from '../ui/CairnStack.tsx';
import { OpenGroupsPreview } from './ListPages.tsx';

/** The hero's sample group (shown as a sample, never as a real listing). */
export const SAMPLE_STONES: Stone[] = [
  { id: 'lena', label: 'Lena', amount: 300, state: 'approved' },
  { id: 'marco', label: 'Marco', amount: 200, state: 'approved' },
  { id: 'you', label: 'You', amount: 150, state: 'in', mine: true },
  { id: 'kim', label: 'Kim', amount: 100, state: 'requested' },
];

const STEPS = [
  {
    title: 'Find people',
    text: 'Say how much you can bring, from 100 DASH up. Join a group an operator has opened, or start one with people who are looking too. Two to eight people make one masternode.',
  },
  {
    title: 'Agree',
    text: 'The group settles the operator, their share of the rewards, who holds the voting key and the early-exit terms. Each of you records your approval of the exact terms on Dash Platform.',
  },
  {
    title: 'Form it in Dash Core',
    text: 'One member starts a shared masternode in Dash Core’s own wizard; everyone else confirms and signs from their own wallet. Cairn checks every message against what you approved.',
  },
  {
    title: 'Share the rewards',
    text: 'Once the masternode is registered, every block that pays it splits the owner reward by share, straight to each member’s own address. Nobody passes coins around.',
  },
];

export function HomePage() {
  const { registry } = useApp();
  return (
    <div className="page home">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-text">
          <h1 id="hero-title">Build a masternode together.</h1>
          <p className="hero-lede">
            A Dash masternode needs 1000 DASH. With Dash Core v24, two to eight people can bring it between them, at least 100 DASH each, and every share stays
            in its owner’s control. Cairn helps you find the others, agree on an operator and terms, and walk through Dash Core’s own steps.
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary btn-l" to="/groups">
              Find a group
            </Link>
            <Link className="btn btn-l" to="/learn">
              How it works
            </Link>
          </div>
          <p className="hero-promise">Cairn never holds your coins or keys. Your DASH moves only in transactions Dash Core checks, never through anyone’s hands.</p>
        </div>
        <div className="hero-cairn">
          <CairnStack stones={SAMPLE_STONES} animate />
          <p className="hero-cairn-note small muted">
            A sample group. Bring 350 DASH, and Lena’s node is ready.
          </p>
        </div>
      </section>

      <section className="steps-section" aria-labelledby="steps-title">
        <h2 id="steps-title">How a shared masternode comes together</h2>
        <ol className="steps">
          {STEPS.map((s) => (
            <li key={s.title} className="step">
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
        <p>
          <Link to="/learn">Read the full guide</Link>, including how leaving works and what each role does.
        </p>
      </section>

      <section className="needs" aria-label="What you need and what you keep">
        <div className="needs-col">
          <h2>What you need</h2>
          <ul className="ticks">
            <li>
              <b>100 DASH or more</b> for your share. Shares can be any amount from 100 DASH, as long as the group’s shares add up to exactly 1000.
            </li>
            <li>
              <b>Dash Core on a computer</b> (Dash-Qt, version 24 or later). Your share’s owner key, refund address and reward address live in that wallet.
            </li>
            <li>
              <b>A Cairn account</b> to make a profile and join a group. It costs about 0.005 DASH, paid from any Dash wallet, and you can browse without one.
            </li>
          </ul>
        </div>
        <div className="needs-col needs-keep">
          <h2>What you never hand over</h2>
          <ul className="crosses">
            <li>
              Your coins. Your share goes into a collateral only a dissolution can spend, and a dissolution sends it back to your refund address, minus any
              agreed early penalty if you leave early.
            </li>
            <li>Your Dash Core wallet’s keys or recovery phrase. Your Cairn account phrase is a separate one that only signs your profile and approvals.</li>
            <li>
              Control of leaving. Any member can leave alone at any time. Everyone gets their share back; whoever leaves before the agreed early period ends pays
              the agreed penalty to the others.
            </li>
          </ul>
        </div>
      </section>

      <section className="home-groups" aria-labelledby="open-groups-title">
        <div className="section-head">
          <h2 id="open-groups-title">Open groups on {registry.label}</h2>
          <Link to="/groups">All groups</Link>
        </div>
        <OpenGroupsPreview />
      </section>

      <ActivationCard />
    </div>
  );
}
