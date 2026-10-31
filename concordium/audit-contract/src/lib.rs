//! Sentinel audit trail.
//!
//! Every verdict the Sentinel swarm issues is hashed (sha256 over the
//! canonical evidence + verdict JSON) and appended here, together with the
//! subject it was about and the agents that produced it. The contract has no
//! update or delete entrypoint: once a record is in, it is in. That is the
//! EU AI Act Art. 12 record: anyone can prove what Sentinel said, when, about
//! what, and which registered agents stood behind it.
//!
//! Entrypoints
//! - `record(RecordParam)`: authorised submitters only; appends one record and
//!   emits a `Verdict` event. Returns the sequence number.
//! - `view(seq)`: one record. `count()`: how many. `info()`: admin + submitters.
//! - `setSubmitter(SubmitterParam)`: admin only; add or remove an authorised
//!   submitter (the Sentinel judge's account).
#![cfg_attr(target_arch = "wasm32", no_std)]
use concordium_std::*;

/// sha256 digest of the canonical verdict JSON.
pub type Digest = [u8; 32];

#[derive(Serialize, SchemaType, Clone, PartialEq, Eq, Debug)]
pub struct Record {
    /// sha256 of {chain, mint, at, evidence, verdict}
    pub digest: Digest,
    /// chain id, e.g. "solana"
    pub chain: String,
    /// subject of the verdict: the token mint
    pub subject: String,
    /// verdict band: SAFE | CAUTION | DANGER | RUGGED
    pub verdict: String,
    /// 0-100
    pub risk_score: u8,
    /// Agent Registry token ids (CIS-8004) of the agents that produced it
    pub agent_ids: Vec<u64>,
    /// snapshot time reported by the engine, unix seconds
    pub observed_at: u64,
    /// block time when the record was appended
    pub recorded_at: Timestamp,
    pub submitter: AccountAddress,
}

#[derive(Serialize, SchemaType)]
pub struct RecordParam {
    pub digest: Digest,
    pub chain: String,
    pub subject: String,
    pub verdict: String,
    pub risk_score: u8,
    pub agent_ids: Vec<u64>,
    pub observed_at: u64,
}

/// How a sealed verdict turned out, read at a fixed horizon after it. The labels follow the
/// published definitions (TVL rug: liquidity drawdown past 99%; idle: no trades left), so any
/// reader with the two market snapshots can reproduce the grade.
#[derive(Serialize, SchemaType, Clone, PartialEq, Eq, Debug)]
pub struct Grade {
    /// seconds after the verdict's observed_at this grade stands for (3600, 86400, 604800)
    pub horizon: u32,
    /// outcome labels, e.g. "tvl_rug", "idle", "price_collapse", "creator_exit"
    pub labels: Vec<String>,
    /// the binary ground truth the verdict is scored against
    pub rugged: bool,
    /// liquidity at the horizon in basis points of liquidity at the verdict; 65535 = unknown
    pub liquidity_bps: u16,
    /// price at the horizon in basis points of price at the verdict; 65535 = unknown
    pub price_bps: u16,
    /// when the outcome was read, unix seconds
    pub observed_at: u64,
    pub recorded_at: Timestamp,
    pub submitter: AccountAddress,
}

#[derive(Serialize, SchemaType)]
pub struct GradeParam {
    /// sequence number of the verdict record being graded
    pub seq: u64,
    pub horizon: u32,
    pub labels: Vec<String>,
    pub rugged: bool,
    pub liquidity_bps: u16,
    pub price_bps: u16,
    pub observed_at: u64,
}

#[derive(Serialize, SchemaType)]
pub struct SubmitterParam {
    pub account: AccountAddress,
    pub allowed: bool,
}

#[derive(Serialize, SchemaType)]
pub struct InitParam {
    /// accounts allowed to call `record` from the start
    pub submitters: Vec<AccountAddress>,
}

#[derive(Serialize, SchemaType)]
pub struct Info {
    pub admin: AccountAddress,
    pub submitters: Vec<AccountAddress>,
    pub count: u64,
}

#[derive(Serial, DeserialWithState)]
#[concordium(state_parameter = "S")]
pub struct State<S: HasStateApi = StateApi> {
    admin: AccountAddress,
    submitters: StateSet<AccountAddress, S>,
    records: StateMap<u64, Record, S>,
    next_seq: u64,
    /// outcome grades per verdict, one per horizon
    grades: StateMap<u64, Vec<Grade>, S>,
}

#[derive(Serialize, SchemaType, Debug, PartialEq, Eq, Reject)]
pub enum Error {
    #[from(ParseError)]
    ParseParams,
    #[from(LogError)]
    LogFull,
    Unauthorized,
    NotFound,
    /// subject/chain/verdict strings must stay short: this is a log, not storage
    TooLong,
    InvalidScore,
    /// a horizon can be graded once per verdict
    AlreadyGraded,
    /// a grade must come after the verdict it grades
    BeforeVerdict,
}

#[derive(Serialize, SchemaType, Debug, PartialEq, Eq)]
pub enum Event {
    Verdict {
        seq: u64,
        digest: Digest,
        chain: String,
        subject: String,
        verdict: String,
        risk_score: u8,
        agent_ids: Vec<u64>,
        submitter: AccountAddress,
    },
    SubmitterChanged {
        account: AccountAddress,
        allowed: bool,
    },
    Graded {
        seq: u64,
        horizon: u32,
        rugged: bool,
        liquidity_bps: u16,
        submitter: AccountAddress,
    },
}

const MAX_LABELS: usize = 8;

const MAX_STR: usize = 96;

#[init(contract = "sentinel_audit", parameter = "InitParam", event = "Event")]
fn init(ctx: &InitContext, state_builder: &mut StateBuilder) -> InitResult<State> {
    let param: InitParam = ctx.parameter_cursor().get()?;
    let mut submitters = state_builder.new_set();
    for s in param.submitters {
        submitters.insert(s);
    }
    Ok(State { admin: ctx.init_origin(), submitters, records: state_builder.new_map(), next_seq: 0, grades: state_builder.new_map() })
}

/// Append one verdict record. Only authorised submitters may call it.
#[receive(contract = "sentinel_audit", name = "record", parameter = "RecordParam", return_value = "u64", error = "Error", enable_logger, mutable)]
fn record(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> Result<u64, Error> {
    let submitter = match ctx.sender() {
        Address::Account(a) => a,
        Address::Contract(_) => return Err(Error::Unauthorized),
    };
    if !host.state().submitters.contains(&submitter) {
        return Err(Error::Unauthorized);
    }
    let p: RecordParam = ctx.parameter_cursor().get()?;
    if p.chain.len() > MAX_STR || p.subject.len() > MAX_STR || p.verdict.len() > MAX_STR {
        return Err(Error::TooLong);
    }
    if p.risk_score > 100 {
        return Err(Error::InvalidScore);
    }
    let seq = host.state().next_seq;
    let rec = Record {
        digest: p.digest,
        chain: p.chain,
        subject: p.subject,
        verdict: p.verdict,
        risk_score: p.risk_score,
        agent_ids: p.agent_ids,
        observed_at: p.observed_at,
        recorded_at: ctx.metadata().block_time(),
        submitter,
    };
    logger.log(&Event::Verdict {
        seq,
        digest: rec.digest,
        chain: rec.chain.clone(),
        subject: rec.subject.clone(),
        verdict: rec.verdict.clone(),
        risk_score: rec.risk_score,
        agent_ids: rec.agent_ids.clone(),
        submitter,
    })?;
    let state = host.state_mut();
    let _ = state.records.insert(seq, rec);
    state.next_seq = seq + 1;
    Ok(seq)
}

/// A submitter grades a sealed verdict against what happened at one horizon. Verdicts are never
/// edited; the grade sits beside the record, and a horizon can be graded once.
#[receive(contract = "sentinel_audit", name = "grade", parameter = "GradeParam", error = "Error", enable_logger, mutable)]
fn grade(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> Result<(), Error> {
    let submitter = match ctx.sender() {
        Address::Account(a) => a,
        Address::Contract(_) => return Err(Error::Unauthorized),
    };
    if !host.state().submitters.contains(&submitter) {
        return Err(Error::Unauthorized);
    }
    let p: GradeParam = ctx.parameter_cursor().get()?;
    if p.labels.len() > MAX_LABELS || p.labels.iter().any(|l| l.len() > MAX_STR) {
        return Err(Error::TooLong);
    }
    let verdict_at = host.state().records.get(&p.seq).map(|r| r.observed_at).ok_or(Error::NotFound)?;
    if p.observed_at < verdict_at {
        return Err(Error::BeforeVerdict);
    }
    if host.state().grades.get(&p.seq).map(|g| g.iter().any(|x| x.horizon == p.horizon)).unwrap_or(false) {
        return Err(Error::AlreadyGraded);
    }
    let g = Grade {
        horizon: p.horizon,
        labels: p.labels,
        rugged: p.rugged,
        liquidity_bps: p.liquidity_bps,
        price_bps: p.price_bps,
        observed_at: p.observed_at,
        recorded_at: ctx.metadata().block_time(),
        submitter,
    };
    logger.log(&Event::Graded { seq: p.seq, horizon: g.horizon, rugged: g.rugged, liquidity_bps: g.liquidity_bps, submitter })?;
    let state = host.state_mut();
    let mut list = state.grades.get(&p.seq).map(|g| g.clone()).unwrap_or_default();
    list.push(g);
    let _ = state.grades.insert(p.seq, list);
    Ok(())
}

/// The grades of one verdict, oldest horizon first as they were recorded; empty when none yet.
#[receive(contract = "sentinel_audit", name = "grades", parameter = "u64", return_value = "Vec<Grade>")]
fn grades(ctx: &ReceiveContext, host: &Host<State>) -> ReceiveResult<Vec<Grade>> {
    let seq: u64 = ctx.parameter_cursor().get()?;
    Ok(host.state().grades.get(&seq).map(|g| g.clone()).unwrap_or_default())
}

#[receive(contract = "sentinel_audit", name = "view", parameter = "u64", return_value = "Record", error = "Error")]
fn view(ctx: &ReceiveContext, host: &Host<State>) -> Result<Record, Error> {
    let seq: u64 = ctx.parameter_cursor().get()?;
    host.state().records.get(&seq).map(|r| r.clone()).ok_or(Error::NotFound)
}

#[receive(contract = "sentinel_audit", name = "count", return_value = "u64")]
fn count(_ctx: &ReceiveContext, host: &Host<State>) -> ReceiveResult<u64> {
    Ok(host.state().next_seq)
}

#[receive(contract = "sentinel_audit", name = "info", return_value = "Info")]
fn info(_ctx: &ReceiveContext, host: &Host<State>) -> ReceiveResult<Info> {
    let s = host.state();
    Ok(Info { admin: s.admin, submitters: s.submitters.iter().map(|a| *a).collect(), count: s.next_seq })
}

/// Admin adds or removes an authorised submitter.
#[receive(contract = "sentinel_audit", name = "setSubmitter", parameter = "SubmitterParam", error = "Error", enable_logger, mutable)]
fn set_submitter(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> Result<(), Error> {
    if ctx.sender() != Address::Account(host.state().admin) {
        return Err(Error::Unauthorized);
    }
    let p: SubmitterParam = ctx.parameter_cursor().get()?;
    if p.allowed {
        host.state_mut().submitters.insert(p.account);
    } else {
        host.state_mut().submitters.remove(&p.account);
    }
    logger.log(&Event::SubmitterChanged { account: p.account, allowed: p.allowed })?;
    Ok(())
}
