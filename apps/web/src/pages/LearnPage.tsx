// The plain-language guide (DESIGN.md E1, S5). Facts follow Dash Core v24 consensus (docs/research/core-shared-mn.md).
import { Link } from 'react-router-dom';
import { ACTIVATION_PAGE } from '../data/activation.ts';
import { CairnStack } from '../ui/CairnStack.tsx';

const TOC = [
  { id: 'what', label: 'What a shared masternode is' },
  { id: 'steps', label: 'The four steps' },
  { id: 'roles', label: 'Who does what' },
  { id: 'need', label: 'What you need' },
  { id: 'never', label: 'What you never hand over' },
  { id: 'leaving', label: 'Leaving and early-exit terms' },
  { id: 'rewards', label: 'How rewards are split' },
  { id: 'care', label: 'Good habits' },
  { id: 'faq', label: 'Questions' },
];

const EXAMPLE = [
  { id: 'a', label: 'Ana', amount: 500, state: 'signed' as const },
  { id: 'b', label: 'Ben', amount: 300, state: 'signed' as const },
  { id: 'c', label: 'Chen', amount: 200, state: 'signed' as const },
];

export function LearnPage() {
  return (
    <div className="page learn-page">
      <header className="page-head">
        <h1>How shared masternodes work</h1>
        <p className="lede">
          Everything you need to decide whether to co-own a Dash masternode, in plain words. It takes about ten minutes to read; the technical details are in
          Dash Core’s own documentation.
        </p>
      </header>
      <div className="learn-layout">
        <nav className="learn-toc" aria-label="On this page">
          <ol>
            {TOC.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`}>{t.label}</a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="prose">
          <section id="what" aria-labelledby="what-h">
            <h2 id="what-h">What a shared masternode is</h2>
            <p>
              A masternode is a Dash server that helps run the network: it locks InstantSend payments, takes part in ChainLocks and votes on the budget. Each one
              is backed by exactly 1000 DASH of collateral, and the network pays it part of every block reward.
            </p>
            <p>
              Since Dash Core v24, that 1000 DASH can come from two to eight people. Each brings a share of at least 100 DASH, and the shares must add up to
              exactly 1000. The network itself keeps each share under its owner’s control:
            </p>
            <ul>
              <li>the coins sit in an output that only a dissolution can spend, and a dissolution always sends every share back to its owner;</li>
              <li>every share has its own owner key, its own refund address (fixed for good) and its own reward address;</li>
              <li>every payout block splits the reward between the shares by amount, directly to each owner’s address.</li>
            </ul>
            <CairnStack stones={EXAMPLE} legend className="learn-cairn" />
            <p>
              Here, Ana, Ben and Chen bring 500, 300 and 200 DASH. Ana receives half of each owner reward, Ben 30% and Chen 20%. None of them can move the others’
              coins.
            </p>
          </section>

          <section id="steps" aria-labelledby="steps-h">
            <h2 id="steps-h">The four steps</h2>
            <ol className="learn-steps">
              <li>
                <h3>Find people</h3>
                <p>
                  On Cairn you can join a group an operator has opened, start one yourself, or say how much you can bring and wait to be invited. A group shows how
                  far it is from 1000 DASH and the terms it proposes.
                </p>
              </li>
              <li>
                <h3>Agree</h3>
                <p>
                  The group settles who runs the node and what share of rewards they take, who coordinates the setup, who holds the voting key and what happens if
                  someone leaves early. Once the organizer locks the terms, each member approves them on Dash Platform. That approval is a public record of exactly
                  what you agreed to, including your own share.
                </p>
              </li>
              <li>
                <h3>Form it in Dash Core</h3>
                <p>
                  One member, the coordinator, starts a shared masternode in Dash Core’s wizard and shares the session with the group. Every member checks it,
                  confirms the terms in their own wallet and signs with their own coins. Cairn’s message checker compares each step with what you approved, so a
                  changed amount or address is caught before you sign. The masternode is registered in a single transaction: either everyone’s share goes in, or
                  nothing happens.
                </p>
              </li>
              <li>
                <h3>Earn together</h3>
                <p>
                  The operator starts the node. From then on the network pays the owner reward, split by share, in every block that pays this masternode. Cairn
                  shows its status from the chain and links to <a href="https://nodes.dashhq.org">Radar</a> and to{' '}
                  <a href="https://gov.dashhq.org">Governance</a> for voting.
                </p>
              </li>
            </ol>
          </section>

          <section id="roles" aria-labelledby="roles-h">
            <h2 id="roles-h">Who does what</h2>
            <dl className="roles">
              <dt>Co-owner</dt>
              <dd>Brings one share of 100 to 900 DASH and keeps its owner key, refund address and reward address in their own Dash Core wallet.</dd>
              <dt>Operator</dt>
              <dd>
                Runs the server. Supplies its public operator key and address, and takes an agreed percentage of rewards. Need not own a share, and never signs
                anything that moves anyone’s coins.
              </dd>
              <dt>Organizer</dt>
              <dd>Whoever opens the group, an operator or a member. Accepts seats, proposes the terms and locks them.</dd>
              <dt>Coordinator</dt>
              <dd>
                The co-owner who runs the setup in Dash-Qt on a computer and pays the network fee of about 0.001 DASH. The group picks one; it must be a co-owner.
              </dd>
              <dt>Voting key holder</dt>
              <dd>
                The one person who votes on Dash governance proposals for this masternode. The group picks them (the coordinator unless it decides otherwise) and
                writes down how they will vote, for example “as the majority of shares decides in the group chat”.
              </dd>
            </dl>
            <p>One person can hold several roles. An operator can also be a co-owner in their own group.</p>
          </section>

          <section id="need" aria-labelledby="need-h">
            <h2 id="need-h">What you need</h2>
            <ul>
              <li>
                <b>A share of at least 100 DASH.</b> The most one person can bring is 900, since a group needs at least two shares.
              </li>
              <li>
                <b>Dash Core 24 or later on a computer.</b> Your share’s keys must live in a Dash Core wallet. A hardware wallet’s message signing cannot sign
                for a share.
              </li>
              <li>
                <b>A Cairn account</b> to make a profile and join a group. You create it by paying about 0.005 DASH from any Dash wallet; it is a Dash Platform
                identity, and its recovery phrase also works in other Dash Platform wallets.
              </li>
              <li>
                <b>Somewhere to talk.</b> Groups agree in their own chat (Discord, Yappr, Telegram or Matrix). Cairn stores the link, not the conversation.
              </li>
            </ul>
          </section>

          <section id="never" aria-labelledby="never-h">
            <h2 id="never-h">What you never hand over</h2>
            <ul>
              <li>Your DASH. It never leaves your wallet until the network itself returns it at dissolution. No person and no website holds it in between.</li>
              <li>Your wallet’s recovery phrase or private keys. Nobody needs them: not the organizer, not the operator, not Cairn.</li>
              <li>
                Your Cairn recovery phrase. It controls your profile and approvals, so keep it for Cairn only, with no money in it beyond a little credit.
              </li>
              <li>
                The operator’s private key, if you are not the operator. Only the person running the node should ever hold it; if someone offers to send it
                around the group, stop.
              </li>
            </ul>
          </section>

          <section id="leaving" aria-labelledby="leaving-h">
            <h2 id="leaving-h">Leaving and early-exit terms</h2>
            <p>
              <b>Any co-owner can leave alone, at any time.</b> Leaving dissolves the masternode, and the network sends every share back to its owner’s refund
              address, including the shares of everyone who stayed. Nobody can keep your coins, and nobody can stop you leaving.
            </p>
            <p>
              Because one person leaving ends the masternode for everyone, groups can agree an <b>early period</b>: if someone leaves before it ends, they pay an
              agreed penalty, shared among the others in proportion to their shares. The rules are set by the network:
            </p>
            <ul>
              <li>the early period is at most 420,480 blocks, about two years;</li>
              <li>the penalty must be smaller than the smallest share, and it is zero when there is no early period;</li>
              <li>after the early period, leaving costs only the network fee (at most 0.01 DASH, paid by whoever leaves);</li>
              <li>if every co-owner agrees to dissolve together, nobody pays a penalty.</li>
            </ul>
            <p className="callout">
              With no early period, anyone can leave at any time without a penalty. That is flexible, but it also means the masternode can end tomorrow. Choose
              terms you would be comfortable with on both sides.
            </p>
            <p>
              After a dissolution, the members who want to continue can open the group again with the same terms; Cairn then looks for someone to bring the
              amount that left.
            </p>
          </section>

          <section id="rewards" aria-labelledby="rewards-h">
            <h2 id="rewards-h">How rewards are split</h2>
            <p>
              When the network pays this masternode, it first pays the operator their agreed percentage, then splits the rest between the shares by amount, to
              each share’s reward address. Nobody collects and redistributes it.
            </p>
            <ul>
              <li>The operator’s percentage is set at registration and cannot be changed later for that masternode.</li>
              <li>The operator is paid only after they set their payout address on the node; until then their part goes to the co-owners.</li>
              <li>You can change your own reward address later; your refund address never changes.</li>
            </ul>
            <p>
              How much a masternode earns depends on the network and changes over time. Cairn makes no promises about it; <a href="https://nodes.dashhq.org">Radar</a>{' '}
              shows what masternodes are actually paid.
            </p>
          </section>

          <section id="care" aria-labelledby="care-h">
            <h2 id="care-h">Good habits</h2>
            <ul>
              <li>
                <b>Use fresh addresses.</b> The share table, with every amount and address, is public on the chain for good.
              </li>
              <li>
                <b>Approve only what you read.</b> Your approval on Cairn names the exact terms and your own row. If Dash Core later shows anything different, the
                checker says so: do not sign.
              </li>
              <li>
                <b>Keep a standby exit.</b> Dash Core can prepare a signed dissolution you keep offline. It stays valid, so you can leave even if you lose access
                later.
              </li>
              <li>
                <b>Back up your wallet.</b> If you lose your owner key, any other member can still dissolve and you get your share back in full, but the group can
                no longer change its operator or voting key.
              </li>
              <li>
                <b>Pick an operator you can reach.</b> If the node goes down for too long the network bans it until the operator fixes it, and nobody is paid
                meanwhile.
              </li>
            </ul>
          </section>

          <section id="faq" aria-labelledby="faq-h">
            <h2 id="faq-h">Questions</h2>
            <details>
              <summary>Does Cairn ever hold my DASH?</summary>
              <p>
                No. Cairn is a website that helps people find each other and check what they agreed. Your coins only move in your own Dash Core wallet, in
                transactions you sign yourself. Cairn charges nothing.
              </p>
            </details>
            <details>
              <summary>Can the organizer or the operator run off with the coins?</summary>
              <p>
                No. The collateral can only be spent by a dissolution, and the network rejects any dissolution that does not return every share to its own refund
                address. The most a stolen owner key could cost the others is the agreed early penalty plus a 0.01 DASH fee.
              </p>
            </details>
            <details>
              <summary>Is this on mainnet yet?</summary>
              <p>
                Shared masternodes need Dash Core v24 to be active. It is active on testnet and waiting for miners on mainnet (see{' '}
                <a href={ACTIVATION_PAGE}>the activation status</a>). You can make a profile and find people on testnet now; on mainnet, forming opens when v24 is
                active.
              </p>
            </details>
            <details>
              <summary>Can I bring less than 100 DASH?</summary>
              <p>No. The network requires every share to be at least 100 DASH. Anything that promises a share for less cannot keep your coins under your control.</p>
            </details>
            <details>
              <summary>What if someone in my group stops answering?</summary>
              <p>
                Before the masternode is formed, the organizer can release their seat and look for someone else. Afterwards, a silent member changes nothing day to
                day: rewards keep arriving. Only changes that need everyone, such as replacing the operator, wait for them.
              </p>
            </details>
            <details>
              <summary>Can my group run an EvoNode?</summary>
              <p>Not yet. Shared EvoNodes need a later Dash Core feature that is not active. Cairn will add them when it is.</p>
            </details>
            <details>
              <summary>Who can see my profile?</summary>
              <p>
                Everyone. Profiles, listings, groups and approvals are public records on Dash Platform, so another website could show them too. Only add contact
                handles you are happy to publish.
              </p>
            </details>
          </section>

          <p className="learn-next">
            Ready? <Link to="/groups">Look at open groups</Link>, or <Link to="/me">make your profile</Link> first.
          </p>
        </article>
      </div>
    </div>
  );
}
