//! Off-chain integration tests for the audit contract (concordium-smart-contract-testing).
use concordium_smart_contract_testing::*;
use concordium_std::Serial;
use sentinel_audit::*;

const ADMIN: AccountAddress = AccountAddress([0u8; 32]);
const JUDGE: AccountAddress = AccountAddress([1u8; 32]);
const STRANGER: AccountAddress = AccountAddress([2u8; 32]);
const SIGNER: Signer = Signer::with_one_key();
const ACC_BALANCE: Amount = Amount::from_ccd(10_000);

fn setup() -> (Chain, ContractAddress) {
    let mut chain = Chain::new();
    for a in [ADMIN, JUDGE, STRANGER] {
        chain.create_account(Account::new(a, ACC_BALANCE));
    }
    let module = module_load_v1("sentinel_audit.wasm.v1").expect("build the module first: cargo concordium build --out sentinel_audit.wasm.v1");
    let deployment = chain.module_deploy_v1(SIGNER, ADMIN, module).expect("deploy");
    let init = chain
        .contract_init(SIGNER, ADMIN, Energy::from(10_000), InitContractPayload {
            amount: Amount::zero(),
            mod_ref: deployment.module_reference,
            init_name: OwnedContractName::new_unchecked("init_sentinel_audit".into()),
            param: OwnedParameter::from_serial(&InitParam { submitters: vec![JUDGE] }).unwrap(),
        })
        .expect("init");
    (chain, init.contract_address)
}

fn param(score: u8) -> RecordParam {
    RecordParam {
        digest: [7u8; 32],
        chain: "solana".into(),
        subject: "Bo9jh3wsmcC2AjakLWzNmKJ3SgtZmXEcSaW7L2FAvUsU".into(),
        verdict: "RUGGED".into(),
        risk_score: score,
        agent_ids: vec![975, 976],
        observed_at: 1_700_000_000,
    }
}

fn update(chain: &mut Chain, sender: AccountAddress, addr: ContractAddress, name: &str, p: &impl Serial) -> Result<ContractInvokeSuccess, ContractInvokeError> {
    chain.contract_update(SIGNER, sender, Address::Account(sender), Energy::from(10_000), UpdateContractPayload {
        amount: Amount::zero(),
        address: addr,
        receive_name: OwnedReceiveName::new_unchecked(format!("sentinel_audit.{name}")),
        message: OwnedParameter::from_serial(p).unwrap(),
    })
}

#[test]
fn judge_records_and_anyone_reads() {
    let (mut chain, addr) = setup();
    let r = update(&mut chain, JUDGE, addr, "record", &param(88)).expect("record");
    let seq: u64 = r.parse_return_value().unwrap();
    assert_eq!(seq, 0);
    let events: Vec<Event> = r.events().flat_map(|(_, evs)| evs.iter().map(|e| e.parse().unwrap())).collect();
    assert!(matches!(events[0], Event::Verdict { seq: 0, risk_score: 88, .. }));

    let v = chain
        .contract_invoke(STRANGER, Address::Account(STRANGER), Energy::from(10_000), UpdateContractPayload {
            amount: Amount::zero(),
            address: addr,
            receive_name: OwnedReceiveName::new_unchecked("sentinel_audit.view".into()),
            message: OwnedParameter::from_serial(&0u64).unwrap(),
        })
        .expect("view");
    let rec: Record = v.parse_return_value().unwrap();
    assert_eq!(rec.digest, [7u8; 32]);
    assert_eq!(rec.verdict, "RUGGED");
    assert_eq!(rec.submitter, JUDGE);
    assert_eq!(rec.agent_ids, vec![975, 976]);
}

#[test]
fn strangers_cannot_record_and_scores_are_checked() {
    let (mut chain, addr) = setup();
    let e = update(&mut chain, STRANGER, addr, "record", &param(10)).expect_err("stranger");
    assert_eq!(e.parse_return_value::<Error>().unwrap(), Error::Unauthorized);
    let e = update(&mut chain, JUDGE, addr, "record", &param(101)).expect_err("score");
    assert_eq!(e.parse_return_value::<Error>().unwrap(), Error::InvalidScore);
}

#[test]
fn admin_manages_submitters_and_records_are_sequential() {
    let (mut chain, addr) = setup();
    update(&mut chain, ADMIN, addr, "setSubmitter", &SubmitterParam { account: STRANGER, allowed: true }).expect("add");
    update(&mut chain, STRANGER, addr, "record", &param(1)).expect("now allowed");
    update(&mut chain, JUDGE, addr, "record", &param(2)).expect("judge");
    update(&mut chain, ADMIN, addr, "setSubmitter", &SubmitterParam { account: STRANGER, allowed: false }).expect("remove");
    update(&mut chain, STRANGER, addr, "record", &param(3)).expect_err("removed");
    let e = update(&mut chain, JUDGE, addr, "setSubmitter", &SubmitterParam { account: JUDGE, allowed: false }).expect_err("not admin");
    assert_eq!(e.parse_return_value::<Error>().unwrap(), Error::Unauthorized);
    let c = chain
        .contract_invoke(STRANGER, Address::Account(STRANGER), Energy::from(10_000), UpdateContractPayload {
            amount: Amount::zero(),
            address: addr,
            receive_name: OwnedReceiveName::new_unchecked("sentinel_audit.count".into()),
            message: OwnedParameter::empty(),
        })
        .expect("count");
    assert_eq!(c.parse_return_value::<u64>().unwrap(), 2);
}

fn grade_param(seq: u64, horizon: u32) -> GradeParam {
    GradeParam { seq, horizon, labels: vec!["tvl_rug".into(), "price_collapse".into()], rugged: true, liquidity_bps: 60, price_bps: 400, observed_at: 1_700_003_600 }
}

#[test]
fn verdicts_are_graded_once_per_horizon_by_submitters_only() {
    let (mut chain, addr) = setup();
    update(&mut chain, JUDGE, addr, "record", &param(20)).expect("record");
    let r = update(&mut chain, JUDGE, addr, "grade", &grade_param(0, 3600)).expect("grade");
    let events: Vec<Event> = r.events().flat_map(|(_, evs)| evs.iter().map(|e| e.parse().unwrap())).collect();
    assert!(matches!(events[0], Event::Graded { seq: 0, horizon: 3600, rugged: true, liquidity_bps: 60, .. }));

    let e = update(&mut chain, JUDGE, addr, "grade", &grade_param(0, 3600)).expect_err("twice");
    assert_eq!(e.parse_return_value::<Error>().unwrap(), Error::AlreadyGraded);
    let e = update(&mut chain, STRANGER, addr, "grade", &grade_param(0, 86_400)).expect_err("stranger");
    assert_eq!(e.parse_return_value::<Error>().unwrap(), Error::Unauthorized);
    let e = update(&mut chain, JUDGE, addr, "grade", &grade_param(7, 86_400)).expect_err("unknown seq");
    assert_eq!(e.parse_return_value::<Error>().unwrap(), Error::NotFound);
    let mut early = grade_param(0, 86_400);
    early.observed_at = 1;
    let e = update(&mut chain, JUDGE, addr, "grade", &early).expect_err("before verdict");
    assert_eq!(e.parse_return_value::<Error>().unwrap(), Error::BeforeVerdict);
    update(&mut chain, JUDGE, addr, "grade", &grade_param(0, 86_400)).expect("second horizon");

    let g = chain
        .contract_invoke(STRANGER, Address::Account(STRANGER), Energy::from(10_000), UpdateContractPayload {
            amount: Amount::zero(),
            address: addr,
            receive_name: OwnedReceiveName::new_unchecked("sentinel_audit.grades".into()),
            message: OwnedParameter::from_serial(&0u64).unwrap(),
        })
        .expect("grades");
    let list: Vec<Grade> = g.parse_return_value().unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].horizon, 3600);
    assert_eq!(list[1].horizon, 86_400);
    assert_eq!(list[0].labels, vec!["tvl_rug", "price_collapse"]);
    assert_eq!(list[0].submitter, JUDGE);
}
