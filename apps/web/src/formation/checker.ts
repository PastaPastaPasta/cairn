// The message checker's view-model: what a pasted Dash-Qt message is, in plain words, and whether it is safe to act on. Pure and
// synchronous: nothing here touches the network, so a message never leaves the browser.
import {
  type ChainShare, type CheckResult, type Finding, type Level, type Network as CoreNetwork, type ProDisReport, type SessionReport, type Stage,
  type TermSheet, bytesToHex, checkEnvelopeAgainstTerms, checkRegistrationAgainstTerms, coreP2PEntries, decodeSharedProRegTx, formatDash,
  identifySpecialTx, inspectProDisTx, isNetwork, keyIdToAddress, parseSessionEnvelope, parseSigsEnvelope, parseStandbyFile, qtTrim,
  findValue, readUniValue, scriptToAddress, verifyJoinSigs,
} from '@cairn/shares';

/** Addresses a row carried in an earlier message (@cairn/shares RowAddresses). */
export interface RowAddresses {
  ownerAddress: string;
  refundAddress?: string;
  rewardAddress?: string;
}

export interface CheckContext {
  /** The network this page shows (for addresses in bare transactions); a session message names its own. */
  network?: CoreNetwork;
  /** The group's approved term sheet; without it nothing can be called safe, only readable. */
  terms?: TermSheet | null;
  /** The checking member's row label. */
  myLabel?: string;
  /** The checking member's owner address, copied from Dash-Qt: binds "my row" to its owner key. */
  myOwnerAddress?: string;
  /** Owner, refund and reward addresses seen per row in earlier messages of the same session. */
  rowAddresses?: Record<string, RowAddresses>;
  /** The masternode's share table from the verified registration (maintenance messages). */
  chainShares?: readonly ChainShare[];
  /** The group's verified registration: a maintenance message about another masternode is refused. */
  proTxHash?: string;
}

export type Verdict = 'ok' | 'warn' | 'stop' | 'neutral';

export interface Fact {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'stop';
}

export interface RowView {
  index: number;
  label: string;
  amount: bigint;
  filled: boolean;
  mine: boolean;
  approval: 'valid' | 'invalid' | 'missing' | null;
  ownerAddress: string;
  refundAddress: string;
  rewardAddress: string;
}

export interface CheckView {
  kind: 'empty' | 'unknown' | 'session' | 'sigs' | 'standby' | 'dissolution' | 'registration' | 'other';
  /** What it is, as Dash-Qt names it: "Locked Terms", "Standby dissolution", ... */
  title: string;
  /** One plain sentence about it. */
  summary: string;
  verdict: Verdict;
  verdictTitle: string;
  verdictText: string;
  /** The formation round this message belongs to (4 = after broadcast). */
  round?: 1 | 2 | 3 | 4;
  facts: Fact[];
  rows: RowView[];
  findings: Finding[];
  technical: Fact[];
  next: string[];
  /** Session messages: who sent what, for remembering rows across messages of one session. */
  session?: { id: string; revision: number; rows: Record<string, RowAddresses> };
}

export const VERDICT_TITLE: Record<Verdict, string> = {
  ok: 'Safe to continue',
  warn: 'Check this',
  stop: 'Stop — don’t sign',
  neutral: 'Valid in Dash Core, not compared with agreed terms',
};

export const dash = (d: bigint) => formatDash(d, { unit: 'DASH', groupSeparator: ',' });
export const dashPlain = (d: bigint) => formatDash(d, { unit: 'DASH' });
const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
const pct = (bps: number) => `${(bps / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
const days = (blocks: number) => Math.round(blocks / 576);
const HEX = /^[0-9a-fA-F]+$/;
const NETWORK_NAMES: Record<string, string> = { main: 'Mainnet', test: 'Testnet', devnet: 'Devnet', regtest: 'Regtest' };
const networkName = (n: string) => NETWORK_NAMES[n] ?? n;

const ROUNDS = {
  1: 'Round 1 of 3: Invitation → Details',
  2: 'Round 2 of 3: Locked Terms → Approval',
  3: 'Round 3 of 3: Signing Request → Signed Contribution',
  4: 'Registered: Final Record',
} as const;
export const roundName = (n: 1 | 2 | 3 | 4) => ROUNDS[n];

/** Dash-Qt's messageName: a session stage is one message sent by the coordinator and its reply sent back. */
export function stageMessage(stage: Stage): { round: 1 | 2 | 3 | 4; request: string; reply: string } {
  switch (stage) {
    case 'draft':
      return { round: 1, request: 'Invitation', reply: 'Details' };
    case 'frozen':
    case 'signing':
      return { round: 2, request: 'Locked Terms', reply: 'Approval' };
    case 'combined':
      return { round: 3, request: 'Signing Request', reply: 'Signed Contribution' };
    case 'fundingSigned':
      return { round: 3, request: 'Signed Contribution', reply: 'Signed Contribution' };
    case 'broadcast':
      return { round: 4, request: 'Final Record', reply: 'Final Record' };
  }
}

function verdictOf(findings: readonly Finding[], comparable: boolean): Verdict {
  if (findings.some((f) => f.level === 'stop')) return 'stop';
  // a warning (an edited message, say) matters even when there is nothing agreed to compare with
  if (findings.some((f) => f.level === 'warn')) return 'warn';
  return comparable ? 'ok' : 'neutral';
}

/** A message for another network than this site's: whatever else it says, nobody here should act on it. */
const wrongNetwork = (message: string, site: CoreNetwork): Finding =>
  f('stop', 'wrong-network', `Wrong network: this message is for ${networkName(message)}, and this site is on ${networkName(site)}`, 'Don’t act on it. Make sure you, the coordinator and Cairn are all on the same network.');

/**
 * Core's refusal in words that help here. Its "update Dash Core" and "unknown network" texts assume a well-formed file from another
 * version; a pasted message missing those fields was cut off or edited, and copying it again is what helps.
 */
function sessionErrorText(text: string, report: SessionReport, site: CoreNetwork | undefined): string {
  const json = readUniValue(text);
  const field = (k: string) => (json ? findValue(json, k) : undefined);
  const damaged = 'This message is incomplete or damaged. Ask the sender to copy it again from Dash-Qt.';
  if (report.errorCode === 'version') return field('version')?.type === 'num' ? 'This message was made by a newer version of Dash Core than this checker reads.' : damaged;
  if (report.errorCode === 'network') {
    const net = field('network');
    if (net?.type !== 'str' || !isNetwork(net.value)) return damaged;
    return `This message is for ${networkName(net.value)}${site ? `, and this site is on ${networkName(site)}` : ''}. Don’t act on it.`;
  }
  return report.error ?? 'Dash Core would refuse this message.';
}

const empty = (kind: CheckView['kind'], title: string, summary: string): CheckView => ({
  kind, title, summary, verdict: 'neutral', verdictTitle: '', verdictText: '', facts: [], rows: [], findings: [], technical: [], next: [],
});

const f = (level: Level, code: string, title: string, detail = ''): Finding => ({ level, code, title, detail });

/** Read a pasted message: a Dash-Qt session or approvals message, a standby dissolution file, or bare transaction hex. */
export function checkMessage(text: string, ctx: CheckContext = {}): CheckView {
  const trimmed = qtTrim(text);
  if (!trimmed) return empty('empty', '', '');
  if (trimmed.startsWith('{')) {
    const json = readUniValue(trimmed);
    const type = json ? findValue(json, 'type') : undefined;
    const t = type?.type === 'str' ? type.value : '';
    if (t === 'dash-shared-mn-session') return sessionView(trimmed, ctx);
    if (t === 'dash-shared-mn-sigs') return sigsView(trimmed, ctx);
    return unknown(json ? 'This is JSON, but not a Dash Core shared masternode message.' : 'This looks like JSON but cannot be read: it may be cut off. Copy the whole message again.');
  }
  const hexLines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 20 && HEX.test(l));
  const singleHex = HEX.test(trimmed.replace(/\s+/g, '')) && !/\n\s*\n/.test(trimmed) && hexLines.length <= 1;
  if (singleHex) return hexView(trimmed.replace(/\s+/g, ''), ctx);
  if (hexLines.length) return standbyView(trimmed, ctx);
  return unknown('This is not a Dash Core shared masternode message. Paste the whole message Dash-Qt copied, a standby dissolution file, or transaction hex.');
}

function unknown(summary: string): CheckView {
  return { ...empty('unknown', 'Not a shared masternode message', summary), verdict: 'stop', verdictTitle: 'Not recognised', verdictText: summary };
}

// ---- session messages ----------------------------------------------------------------------------------------------------------

/** BIP68: a sequence without the disable flag carries a relative lock (Core's shared_sign refuses it). */
const relativeLock = (sequence: number) => (sequence & 0x80000000) === 0;

/** What a session message shows without agreed terms: Dash Core's verdict and the things Core only warns about. */
function standaloneFindings(report: SessionReport, site: CoreNetwork | undefined): Finding[] {
  const out: Finding[] = [];
  const env = report.envelope!;
  if (site && env.network !== site) out.push(wrongNetwork(env.network, site));
  if (!report.ok) out.push(f('stop', `core-${report.errorCode}`, 'Dash Core would refuse this message', report.error ?? ''));
  else out.push(f('ok', 'core-ok', 'Dash Core would accept this message', 'It parses and checks exactly as Dash-Qt’s own import does.'));
  const fp = report.fingerprint!;
  if (fp.status === 'mismatch') {
    out.push(f('warn', 'fingerprint-mismatch', 'This message was edited after it was copied', `It says Code ${fp.stamped} but its content gives Code ${fp.computed}. Ask the sender for a fresh copy and compare codes.`));
  } else if (fp.status === 'ok') {
    out.push(f('ok', 'fingerprint', `Message code ${fp.computed}`, 'Compare this code with the one the sender sees in Dash-Qt.'));
  }
  if (env.terms.earlyPeriodBlocks === 0) {
    out.push(f('warn', 'no-early-period', 'Anyone can leave at any time', 'There is no early period, so any co-owner can dissolve the masternode whenever they like, paying only the network fee. Every principal is still refunded.'));
  }
  const locked = [...env.contributions.flatMap((c) => c.inputs), ...(report.frozen?.tx.vin.map((i) => ({ sequence: i.sequence, txid: i.prevout.txid, vout: i.prevout.vout })) ?? [])].filter((i) =>
    relativeLock(i.sequence),
  );
  if (locked.length) out.push(f('stop', 'time-lock', 'Some coins would be time-locked', locked.map((i) => `${i.txid.slice(0, 8)}:${i.vout} sequence 0x${i.sequence.toString(16)}`).join('; ')));
  for (const r of report.rows) if (r.badAddresses.length) out.push(f('warn', 'bad-address', `${r.label || `Row ${r.index + 1}`} has an address that is not valid here`, `invalid: ${r.badAddresses.join(', ')}`));
  for (const s of report.sigs) if (s.present && s.valid === false) out.push(f('warn', 'approval-invalid', `${s.label}’s approval does not match these terms`, s.reason ?? ''));
  out.push(
    f('info', 'no-terms', 'Nothing agreed to compare with', 'Open the checker from your group’s formation page to compare every share, the operator, the reward, the IP address and the exit terms with the terms you approved on Cairn.'),
  );
  return out;
}

function sessionView(text: string, ctx: CheckContext): CheckView {
  const terms = ctx.terms ?? undefined;
  const network = terms?.network;
  const report = parseSessionEnvelope(text, network ? { network } : {});
  const env = report.envelope;
  if (!env) {
    const why = sessionErrorText(text, report, network ?? ctx.network);
    const findings = terms ? checkEnvelopeAgainstTerms(report, terms).findings : [f('stop', `core-${report.errorCode}`, 'Dash Core would refuse this message', why)];
    return {
      ...empty('session', 'Shared masternode message', why),
      verdict: 'stop', verdictTitle: VERDICT_TITLE.stop, verdictText: 'Dash Core would refuse this message, so nobody can act on it. Ask the sender to copy it again.', findings,
      next: ['Don’t act on this message.', 'Ask the sender to copy it again from Dash-Qt, and compare the message code they see with the one shown here.'],
    };
  }
  const msg = stageMessage(env.stage);
  const myLabel = ctx.myLabel?.trim() || undefined;
  const myOwner = ctx.myOwnerAddress?.trim() || undefined;
  let result: CheckResult | null = null;
  let findings: Finding[];
  if (terms) {
    result = checkEnvelopeAgainstTerms(report, terms, { ...(myLabel ? { myLabel } : {}), ...(myOwner ? { myOwnerAddress: myOwner } : {}), ...(ctx.rowAddresses ? { rowAddresses: ctx.rowAddresses } : {}) });
    findings = result.findings.filter((x) => x.code !== 'stage');
    const myRow = myLabel ? env.shares.find((s) => s.label.trim() === myLabel) : undefined;
    if (myRow?.ownerAddress && !myOwner) {
      findings.push(
        f('warn', 'my-row-unbound', 'Confirm this row is yours', 'Your row has an owner address now. Paste your owner address from Dash-Qt (Your share → Owner address) so Cairn can check that your share was not moved to someone else’s row.'),
      );
    }
  } else {
    findings = standaloneFindings(report, ctx.network);
  }
  const verdict = verdictOf(findings, !!terms);
  const valid = report.sigs.filter((s) => s.present && s.valid).length;
  const present = report.sigs.filter((s) => s.present).length;
  const filled = report.rows.filter((r) => r.filled).length;
  const signedInputs = report.fundingInputs.filter((i) => i.signed).length;
  const fp = report.fingerprint!;
  const siteNetwork = terms?.network ?? ctx.network;
  const facts: Fact[] = [
    { label: 'Message code', value: fp.status === 'absent' ? `none (content gives ${fp.computed})` : fp.status === 'ok' ? fp.computed : `${fp.stamped}, edited: content gives ${fp.computed}`, tone: fp.status === 'mismatch' ? 'warn' : undefined },
    { label: 'Message', value: msg.request === msg.reply ? msg.request : `${msg.request} (members reply with ${/^[AEIOU]/.test(msg.reply) ? 'an' : 'a'} ${msg.reply})` },
    { label: 'Stage', value: report.stageName ?? env.stage },
    { label: 'Revision', value: String(env.revision) },
    { label: 'Network', value: networkName(env.network), tone: siteNetwork && env.network !== siteNetwork ? 'stop' : undefined },
    { label: 'Rows filled', value: `${filled} of ${env.shares.length}` },
  ];
  if (msg.round >= 2) facts.push({ label: 'Approvals', value: `${valid} of ${env.shares.length} valid${present > valid ? `, ${present - valid} invalid` : ''}`, tone: present > valid ? 'warn' : undefined });
  if (msg.round >= 3) facts.push({ label: 'Coins signed', value: `${signedInputs} of ${report.fundingInputs.length} funding inputs` });
  if (env.coordinatorLabel) facts.push({ label: 'Coordinator', value: env.coordinatorLabel });

  const rows: RowView[] = env.shares.map((s, i) => {
    const sig = report.sigs[i];
    return {
      index: i,
      label: s.label,
      amount: s.amount,
      filled: report.rows[i]?.filled ?? false,
      mine: (!!myLabel && s.label.trim() === myLabel) || (!!myOwner && s.ownerAddress === myOwner),
      approval: msg.round < 2 ? null : sig?.present ? (sig.valid ? 'valid' : 'invalid') : 'missing',
      ownerAddress: s.ownerAddress,
      refundAddress: s.refundAddress,
      rewardAddress: s.rewardAddress,
    };
  });
  const t = env.terms;
  const technical: Fact[] = [
    { label: 'Session', value: report.sessionCode ?? '' },
    { label: 'Session id', value: env.sessionId },
    { label: 'Service', value: t.coreP2PAddrs || '(none yet)' },
    { label: 'Operator key', value: t.operatorPubKey || '(none)' },
    { label: 'Node run by', value: env.operatorSecretHolder || '(not given)' },
    { label: 'Voting address', value: t.votingAddress || '(none)' },
    { label: 'Operator reward', value: `${pct(t.operatorReward)} (${t.operatorReward} basis points)` },
    { label: 'Early period', value: `${t.earlyPeriodBlocks.toLocaleString('en-US')} blocks (about ${days(t.earlyPeriodBlocks)} days)` },
    { label: 'Early-exit penalty', value: dash(t.earlyPenalty) },
    ...env.contributions.map((c) => ({
      label: `Coins of ${c.label}`,
      value: `${c.inputs.map((i) => `${i.txid}:${i.vout}`).join(', ')}${c.change ? `; change ${dash(c.change.amount)} to ${c.change.address}` : '; no change'}`,
    })),
  ];
  if (report.frozen) {
    technical.push({ label: 'Prepared transaction', value: report.frozen.txid }, { label: 'Consent hash', value: env.consentHash });
  }
  if (env.prepareWallet) technical.push({ label: 'Prepared in wallet', value: env.prepareWallet });

  const seen: Record<string, RowAddresses> = {};
  for (const s of env.shares) if (s.ownerAddress) seen[s.label.trim()] = { ownerAddress: s.ownerAddress, refundAddress: s.refundAddress, rewardAddress: s.rewardAddress };

  return {
    kind: 'session',
    title: msg.round === 4 ? 'Final Record' : msg.request,
    summary: `${roundName(msg.round)}. Session ${report.sessionCode}, revision ${env.revision}, on ${networkName(env.network)}.`,
    round: msg.round,
    verdict,
    verdictTitle: VERDICT_TITLE[verdict],
    verdictText: verdictText(verdict, !!terms),
    facts,
    rows,
    findings,
    technical,
    next: sessionNext(env.stage, verdict),
    session: { id: env.sessionId, revision: env.revision, rows: seen },
  };
}

function verdictText(v: Verdict, comparable: boolean): string {
  switch (v) {
    case 'ok':
      return 'Everything Cairn can check matches the terms your group approved. Dash-Qt still checks your own coins and addresses.';
    case 'warn':
      return 'Nothing contradicts the approved terms, but something needs your attention before you continue.';
    case 'stop':
      return comparable
        ? 'This message does not match what your group approved, or Dash Core would refuse it. Don’t approve, sign or send anything from it.'
        : 'Dash Core would refuse this message, or it would lock coins. Don’t approve, sign or send anything from it.';
    case 'neutral':
      return 'Dash Core would accept this message, but nothing here says it is what your group agreed. Open it from your group’s Form page to check it against what you approved.';
  }
}

function sessionNext(stage: Stage, v: Verdict): string[] {
  if (v === 'stop') {
    return [
      'Don’t approve, sign or send anything from this message.',
      'Ask the coordinator to copy it again, and compare the message code they see in Dash-Qt with the one here.',
      'If it still fails, raise it in your group chat before anyone signs.',
    ];
  }
  // approving or signing is only ever suggested for a message checked safe against the approved terms
  if (v !== 'ok' && (stage === 'frozen' || stage === 'signing' || stage === 'combined')) {
    return v === 'warn'
      ? ['Sort out every point marked Check above before you approve or sign anything in Dash-Qt.', 'If the message was edited, ask the coordinator for a fresh copy and check it again.']
      : ['Open this message from your group’s Form page, so Cairn can compare it with the terms you approved, before you approve or sign anything in Dash-Qt.'];
  }
  switch (stage) {
    case 'draft':
      return [
        'In Dash-Qt: Masternodes tab → Shared Masternode… → Paste From Clipboard.',
        'Under “This is me”, choose your own row; use “Use new address” for your owner, refund and reward addresses.',
        'Press “Reserve Coins and Copy Details” and send that reply to the coordinator.',
      ];
    case 'frozen':
    case 'signing':
      return ['Paste it into Dash-Qt and read every line.', 'If it matches, press “Approve and Copy Reply” and send the reply to the coordinator.'];
    case 'combined':
      return ['Paste it into Dash-Qt; your wallet signs only your own coins.', 'Press “Sign and Copy Reply” and send the reply to the coordinator.'];
    case 'fundingSigned':
      return ['The coordinator pastes every signed contribution and presses “Broadcast Registration”.'];
    case 'broadcast':
      return ['The masternode is registered. Link its ProTx hash on your group’s page so everyone sees it verified.', 'Then create and save your standby dissolution.'];
  }
}

// ---- maintenance: dash-shared-mn-sigs ------------------------------------------------------------------------------------------

function sigsView(text: string, ctx: CheckContext): CheckView {
  const network = ctx.terms?.network ?? ctx.network;
  const report = parseSigsEnvelope(text, { ...(network ? { network } : {}), ...(ctx.proTxHash ? { proTxHash: ctx.proTxHash } : {}), ...(ctx.chainShares ? { shares: ctx.chainShares } : {}) });
  const kind = report.kind === 'dissolve' ? 'dissolve' : report.kind === 'registrar' ? 'registrar' : null;
  const title = kind === 'dissolve' ? 'Request to dissolve together' : kind === 'registrar' ? 'Request to change the operator or voting key' : 'Approvals message';
  const findings: Finding[] = [];
  if (network && report.network && isNetwork(report.network) && report.network !== network) findings.push(wrongNetwork(report.network, network));
  else if (!report.ok) findings.push(f('stop', 'sigs-refused', 'Dash Core would refuse this message', report.error ?? ''));
  const fp = report.fingerprint;
  if (fp?.status === 'mismatch') findings.push(f('warn', 'fingerprint-mismatch', 'This message was edited after it was copied', `It says Code ${fp.stamped} but its content gives Code ${fp.computed}.`));
  else if (fp?.status === 'ok') findings.push(f('ok', 'fingerprint', `Message code ${fp.computed}`, 'Compare this code with the one the sender sees in Dash-Qt.'));
  const signed = report.signatures.length;
  const total = ctx.chainShares?.length;
  const valid = report.signatures.filter((s) => s.valid === true).length;
  if (report.ok && !report.txHex) {
    findings.push(f('stop', 'sigs-no-tx', 'This message has no transaction to approve', 'A request from Dash-Qt always carries the prepared transaction. Ask for a fresh copy.'));
  } else if (report.ok && ctx.chainShares) {
    if (!report.signHash) findings.push(f('stop', 'sigs-unreadable', 'The prepared transaction could not be checked', ''));
    for (const s of report.signatures.filter((x) => x.valid !== true)) findings.push(f('warn', 'approval-invalid', `The approval for share ${s.shareIndex + 1} does not match`, s.reason ?? ''));
    if (kind === 'dissolve') {
      const r = report.dissolution?.reading;
      if (r?.returnsPrincipal) findings.push(f('ok', 'returns-principal', 'Every share gets its full principal back', `The fee, ${dash(r.fee)}, comes out of share ${report.dissolution!.actorIndex + 1}.`));
      else findings.push(f('stop', 'dissolve-principal', 'This request does not return every principal', r?.error ?? ''));
    }
    if (kind === 'registrar') {
      findings.push(f('warn', 'new-keys', 'Confirm the new keys with your group', 'Cairn cannot know which operator key or voting address your group chose now. Compare both with what was agreed in your group chat before you approve.'));
    }
  } else if (report.ok) {
    findings.push(f('info', 'no-shares', 'Approvals not checked here', 'Open the checker from your group’s live page: with the registered share table Cairn checks every approval and that every principal is returned.'));
  }
  const facts: Fact[] = [
    { label: 'Message', value: title },
    { label: 'Masternode', value: report.proTxHash ? shortHash(report.proTxHash) : '(missing)' },
    { label: 'Network', value: report.network ? networkName(report.network) : '(missing)' },
    { label: 'Approvals included', value: total ? `${signed} of ${total}${ctx.chainShares ? `, ${valid} valid` : ''}` : String(signed) },
  ];
  if (fp) facts.push({ label: 'Message code', value: fp.status === 'mismatch' ? `${fp.stamped}, edited: content gives ${fp.computed}` : fp.computed, tone: fp.status === 'mismatch' ? 'warn' : undefined });
  const technical: Fact[] = [];
  if (report.proTxHash) technical.push({ label: 'ProTx hash', value: report.proTxHash });
  if (report.signHash) technical.push({ label: 'Sign hash', value: report.signHash.hex });
  if (report.registrar) {
    const net: CoreNetwork = isNetwork(report.network) ? report.network : (ctx.network ?? 'test');
    const opKey = bytesToHex(report.registrar.pubKeyOperator);
    facts.push({ label: 'New operator key', value: `${opKey.slice(0, 12)}…${opKey.slice(-8)}` }, { label: 'New voting address', value: keyIdToAddress(report.registrar.keyIDVoting, net) });
    technical.push({ label: 'Operator key', value: opKey });
  }
  if (report.dissolution) {
    const d = report.dissolution;
    facts.push({ label: 'Fee paid by', value: `share ${d.actorIndex + 1}` });
    if (d.reading) technical.push(...d.reading.payouts.map((p, i) => ({ label: `Share ${i + 1} receives`, value: dash(p) })));
  }
  const verdict = verdictOf(findings, !!ctx.chainShares);
  return {
    kind: 'sigs',
    title,
    summary:
      kind === 'dissolve'
        ? 'Every co-owner approves ending the masternode together, free of any penalty. Everyone’s principal returns to their refund address.'
        : kind === 'registrar'
          ? 'Every co-owner must approve a new operator key or voting address. Changing the operator key bans the masternode until the new operator sends a service update.'
          : 'A maintenance message from Dash-Qt.',
    verdict,
    verdictTitle: VERDICT_TITLE[verdict],
    verdictText:
      verdict === 'ok'
        ? 'This request is for your masternode and every approval in it is valid.'
        : verdict === 'neutral'
          ? 'Dash Core would accept this message. Open it from your group’s live page to check it against the registered masternode.'
          : verdictText(verdict, true),
    facts,
    rows: [],
    findings,
    technical,
    next:
      verdict === 'stop'
        ? ['Don’t approve it. Ask whoever prepared it for a fresh request.']
        : verdict === 'neutral'
          ? ['Open it from your group’s live page, so Cairn can check it against the registered masternode, before you approve it in Dash-Qt.']
          : verdict === 'warn'
            ? ['Confirm every point marked Check above with your group before you approve it in Dash-Qt.']
            : kind === 'dissolve'
          ? ['In Dash-Qt: Masternodes tab → right-click the masternode → Dissolve… → Dissolve Together.', 'Paste the request, read the payouts, then press “Approve and Copy Reply”.']
          : ['In Dash-Qt: Masternodes tab → right-click the masternode → Rotate Keys….', 'Paste the request, check the new keys, then press “Approve and Copy Reply”. Only the wallet that prepared it can send it.'],
  };
}

// ---- dissolutions: standby files and bare ProDisTx -----------------------------------------------------------------------------

const MAX_DISSOLVE_FEE = 1_000_000n;

/** A signed dissolution judged against the share table: Core's layout, nobody below their principal, the fee cap, valid signatures. */
export function judgeDissolution(rep: ProDisReport, shares: readonly ChainShare[]): Finding[] {
  const out: Finding[] = [];
  const r = rep.reading;
  if (!r || !r.layoutOk) {
    out.push(f('stop', 'dissolve-layout', 'This dissolution does not pay the shares the way Dash Core requires', r?.error ?? ''));
    return out;
  }
  const short = shares.flatMap((s, i) => (i !== rep.actorIndex && r.payouts[i]! < s.amount ? [i + 1] : []));
  if (short.length) out.push(f('stop', 'dissolve-short', `Share ${short.join(', ')} would get back less than its principal`, ''));
  if (r.fee > MAX_DISSOLVE_FEE) out.push(f('stop', 'dissolve-fee', 'The fee is above Dash Core’s 0.01 DASH cap', dash(r.fee)));
  const bonus = r.bonuses.reduce((a, b) => a + (b > 0n ? b : 0n), 0n);
  if (!short.length) out.push(f('ok', 'dissolve-principal', bonus > 0n ? `Every other share gets its principal plus ${dash(bonus)} of penalty` : 'Every share gets its full principal back', `fee ${dash(r.fee)}`));
  const bad = rep.sigs?.filter((s) => !s.valid) ?? [];
  if (rep.mode === 'unanimous' && rep.sigs && rep.sigs.length !== shares.length) {
    out.push(f('stop', 'dissolve-sig-count', `Signed by ${rep.sigs.length} of ${shares.length} shares`, 'Dash Core accepts one signature (leaving alone) or one from every share.'));
  } else if (rep.sigs && !bad.length && rep.sigs.length) out.push(f('ok', 'dissolve-sigs', `${rep.mode === 'unilateral' ? 'Signed by share' : 'Signed by every share, fee from share'} ${rep.actorIndex + 1}`, ''));
  if (bad.length) out.push(f('stop', 'dissolve-sigs', 'A signature does not match the masternode’s owner keys', bad.map((s) => s.reason ?? '').join('; ')));
  return out;
}

function dissolutionFacts(rep: ProDisReport): Fact[] {
  return [
    { label: 'Masternode', value: shortHash(rep.proTxHash) },
    { label: 'Leaving share', value: `share ${rep.actorIndex + 1}` },
    { label: 'Signed', value: rep.mode === 'unsigned' ? 'not yet (a request)' : rep.mode === 'unilateral' ? 'by one owner (leaving alone)' : 'by every owner' },
  ];
}

const KEEP_PRIVATE = f(
  'info',
  'keep-private',
  'Anyone who has this can broadcast it',
  'A signed dissolution ends the masternode for everyone the moment someone sends it. Every principal still goes back to its own refund address, but keep the file private and offline.',
);

function standbyView(text: string, ctx: CheckContext): CheckView {
  const file = parseStandbyFile(text, ctx.chainShares);
  if (!file.transactions.length) return unknown('This text has transaction-like lines, but none is a shared masternode dissolution.');
  const findings: Finding[] = [KEEP_PRIVATE];
  const others = ctx.proTxHash ? file.transactions.filter((t) => t.proTxHash !== ctx.proTxHash!.toLowerCase()) : [];
  if (others.length) findings.push(f('stop', 'other-masternode', 'This standby dissolution is for a different masternode', others.map((t) => t.proTxHash).join(', ')));
  if (file.transactions.some((t) => t.mode === 'unsigned')) findings.push(f('stop', 'standby-unsigned', 'A line is an unsigned request, not a standby dissolution', 'It cannot be broadcast. Create the standby dissolution again in Dash-Qt.'));
  if (ctx.chainShares) for (const t of file.transactions) findings.push(...judgeDissolution(t, ctx.chainShares).map((x) => ({ ...x, title: `${t === file.immediate ? 'Immediate' : 'Full principal'}: ${x.title}` })));
  else findings.push(f('info', 'no-shares', 'Payouts not checked here', 'Open the checker from your group’s live page to check the payouts and signatures against the registered masternode.'));
  const first = file.transactions[0]!;
  const facts: Fact[] = [...dissolutionFacts(first), { label: 'Transactions', value: `${file.transactions.length}` }];
  if (file.validFromHeight) facts.push({ label: 'Full principal valid from', value: `block ${file.validFromHeight.toLocaleString('en-US')}` });
  if (file.immediate) facts.push({ label: 'Immediate', value: 'valid now, pays the early-exit penalty' });
  const verdict = verdictOf(findings, !!ctx.chainShares);
  return {
    kind: 'standby',
    title: 'Standby dissolution',
    summary: 'Signed dissolutions kept offline in case you ever need to leave without the others: they return every principal and never expire.',
    verdict,
    verdictTitle: verdict === 'ok' ? 'Valid standby dissolution' : VERDICT_TITLE[verdict],
    verdictText: verdict === 'ok' ? 'Every line pays every share correctly and is signed by the leaving share’s owner key. Keep the file with your refund-address backup.' : verdict === 'neutral' ? 'Readable. Keep it private and offline.' : verdictText(verdict, true),
    facts,
    rows: [],
    findings,
    technical: file.transactions.map((t, i) => ({ label: `Transaction ${i + 1}`, value: t.txid })),
    next: ['Store it with your refund-address backup, separately from this wallet.', 'Only if you ever need it: dash-cli sendrawtransaction <one of its lines>.'],
  };
}

// ---- bare transaction hex ------------------------------------------------------------------------------------------------------

function hexView(hex: string, ctx: CheckContext): CheckView {
  let info: ReturnType<typeof identifySpecialTx>;
  try {
    info = identifySpecialTx(hex);
  } catch {
    return unknown('This hex is not a transaction Dash Core can read.');
  }
  if (info.kind === 'proDisTx') {
    const rep = inspectProDisTx(hex, ctx.chainShares);
    const findings: Finding[] = rep.mode === 'unsigned' ? [] : [KEEP_PRIVATE];
    if (ctx.proTxHash && rep.proTxHash !== ctx.proTxHash.toLowerCase()) findings.push(f('stop', 'other-masternode', 'This dissolution is for a different masternode', rep.proTxHash));
    if (ctx.chainShares) findings.push(...judgeDissolution(rep, ctx.chainShares));
    const verdict = verdictOf(findings, !!ctx.chainShares);
    return {
      kind: 'dissolution',
      title: 'Dissolution transaction',
      summary: 'A transaction that ends the masternode and returns every share’s principal to its refund address.',
      verdict,
      verdictTitle: VERDICT_TITLE[verdict],
      verdictText: verdict === 'neutral' ? 'Readable. Open it from your group’s live page to check the payouts against the registered masternode.' : verdictText(verdict, true),
      facts: dissolutionFacts(rep),
      rows: [],
      findings,
      technical: [{ label: 'Transaction id', value: rep.txid }, { label: 'ProTx hash', value: rep.proTxHash }],
      next: ['Keep it private and offline; broadcast it only if you mean to dissolve the masternode.'],
    };
  }
  if (info.kind === 'proRegTx') return registrationView(hex, ctx);
  if (info.kind === 'proUpShareTx' || info.kind === 'proUpSharedRegTx') {
    const view = empty('other', info.kind === 'proUpShareTx' ? 'Reward address change' : 'Operator or voting key change', '');
    view.summary = info.kind === 'proUpShareTx' ? `Changes where share ${info.payload.shareIndex + 1} of masternode ${info.proTxHash.slice(0, 8)}… is paid. Only that share’s owner signs it.` : `Changes the operator or voting key of masternode ${info.proTxHash.slice(0, 8)}…. Every co-owner signs it.`;
    view.technical = [{ label: 'Transaction id', value: info.txid }, { label: 'ProTx hash', value: info.proTxHash }];
    view.verdictText = 'Readable.';
    return view;
  }
  return unknown('This transaction is not a shared masternode message.');
}

function registrationView(hex: string, ctx: CheckContext): CheckView {
  let d: ReturnType<typeof decodeSharedProRegTx>;
  try {
    d = decodeSharedProRegTx(hex);
  } catch (e) {
    return unknown(`This is a masternode registration, but not a shared one (${e instanceof Error ? e.message : String(e)}).`);
  }
  const p = d.payload;
  // shared_register_prepare leaves zeroed placeholder signatures until the approvals are combined
  const awaiting = p.joinSigs.every((s) => s.every((b) => b === 0));
  const net: CoreNetwork = ctx.terms?.network ?? ctx.network ?? 'test';
  let findings: Finding[];
  if (ctx.terms) {
    const myLabel = ctx.myLabel?.trim();
    const mine = myLabel ? ctx.terms.shares.find((s) => s.label.trim() === myLabel) : undefined;
    const myOwner = ctx.myOwnerAddress?.trim();
    findings = checkRegistrationAgainstTerms(hex, ctx.terms, {
      ...(ctx.proTxHash ? { proTxHash: ctx.proTxHash } : {}),
      ...(mine && myOwner ? { owners: [{ ownerAddress: myOwner, amount: mine.amount, label: mine.label }] } : {}),
    })
      .findings.filter((x) => x.code !== 'protx' && x.code !== 'addresses')
      .map((x) => (awaiting && x.code === 'join-sigs' ? f('info', 'join-sigs', 'Prepared, waiting for every co-owner’s approval', '') : x));
    if (mine && myOwner && !findings.some((x) => x.code.startsWith('owner-'))) findings.push(f('ok', 'my-share', `Your share: ${dash(mine.amount)}, with your owner key`, `owner ${myOwner}`));
    else if (mine && !myOwner) {
      findings.push(f('warn', 'my-share-unbound', 'Confirm your share is yours', 'Paste your owner address from Dash-Qt so Cairn can check that your amount is on your own owner key and not on someone else’s.'));
    }
  } else {
    const { results } = verifyJoinSigs(d.tx, p);
    const bad = results.filter((r) => !r.ok);
    findings = [
      awaiting ? f('info', 'join-sigs', 'Prepared, waiting for every co-owner’s approval', '') : bad.length ? f('stop', 'join-sigs', 'Not every co-owner’s approval is valid', bad.map((r) => `share ${r.shareIndex + 1}: ${r.reason}`).join('; ')) : f('ok', 'join-sigs', `All ${results.length} co-owner approvals are valid`, ''),
      f('info', 'no-terms', 'Nothing agreed to compare with', 'Open the checker from your group’s formation page to compare it with the approved terms.'),
    ];
  }
  const signed = d.tx.vin.filter((i) => i.scriptSig.length > 0).length;
  const service = coreP2PEntries(p.netInfo);
  const facts: Fact[] = [
    { label: 'ProTx hash', value: shortHash(d.txid) },
    { label: 'Shares', value: p.shares.map((s) => dash(s.amount)).join(' · ') },
    { label: 'Operator reward', value: pct(p.operatorReward) },
    { label: 'Early-exit terms', value: p.earlyPeriodBlocks ? `${dash(p.earlyPenalty)} for leaving in the first ${p.earlyPeriodBlocks.toLocaleString('en-US')} blocks (about ${days(p.earlyPeriodBlocks)} days)` : 'none: anyone can leave at any time' },
    { label: 'Service', value: service.length ? service.join(', ') : 'none yet (banned until the operator sets one)' },
    { label: 'Funding inputs signed', value: `${signed} of ${d.tx.vin.length}` },
  ];
  const verdict = verdictOf(findings, !!ctx.terms);
  return {
    kind: 'registration',
    title: 'Shared masternode registration',
    summary: 'The registration transaction itself (ProRegTx), with every co-owner’s approval inside.',
    verdict,
    verdictTitle: VERDICT_TITLE[verdict],
    verdictText: verdict === 'ok' ? 'It registers exactly the approved terms, and every co-owner’s approval is valid.' : verdictText(verdict, !!ctx.terms),
    facts,
    rows: [],
    findings,
    technical: [
      { label: 'ProTx hash', value: d.txid },
      { label: 'Operator key', value: bytesToHex(p.pubKeyOperator) },
      { label: 'Voting address', value: keyIdToAddress(p.keyIDVoting, net) },
      ...p.shares.map((s, i) => ({ label: `Share ${i + 1} refund`, value: scriptToAddress(s.scriptRefund, net) ?? bytesToHex(s.scriptRefund) })),
    ],
    next: ['Once it is mined, link its ProTx hash on your group’s page.'],
  };
}
