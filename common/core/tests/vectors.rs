//! Runs the conformance vectors of `common/vectors/names` against the Rust core. Any other client (web,
//! Android, iOS) that re-implements a rule runs the same files, so a divergence fails a test.

use kubuno_drive_core::{
    comparison_key, conflict_copy_name, unique_name_among, verdict, CaseRule, ConflictStamp,
    Profile, Verdict,
};
use serde_json::{json, Value};

fn path(name: &str) -> String {
    format!("{}/../vectors/names/{name}", env!("CARGO_MANIFEST_DIR"))
}

fn text<'a>(input: &'a Value, key: &str) -> &'a str {
    input[key]
        .as_str()
        .unwrap_or_else(|| panic!("input.{key} is not a string"))
}

fn number(input: &Value, key: &str) -> u64 {
    input[key]
        .as_u64()
        .unwrap_or_else(|| panic!("input.{key} is not a number"))
}

#[test]
fn verdicts() {
    kubuno_vectors::assert_suite(path("verdict.json"), |input| {
        let profile = Profile::from_code(text(input, "profile")).expect("unknown profile");
        match verdict(text(input, "name"), profile) {
            Verdict::Valid => json!({ "verdict": "valid" }),
            Verdict::Invalid(reason) => json!({ "verdict": "invalid", "reason": reason.code() }),
            Verdict::PortableWarning(issues) => json!({
                "verdict": "portable-warning",
                "issues": issues.iter().map(|r| r.code()).collect::<Vec<_>>(),
            }),
        }
    });
}

#[test]
fn numbering() {
    kubuno_vectors::assert_suite(path("numbering.json"), |input| {
        let existing: Vec<String> =
            serde_json::from_value(input["existing"].clone()).expect("input.existing");
        let case = match text(input, "case") {
            "insensitive" => CaseRule::Insensitive,
            _ => CaseRule::Sensitive,
        };
        let folder = input["folder"].as_bool().unwrap_or(false);
        json!(unique_name_among(
            text(input, "desired"),
            folder,
            &existing,
            case
        ))
    });
}

#[test]
fn comparison_keys() {
    kubuno_vectors::assert_suite(path("comparison-key.json"), |input| {
        json!(comparison_key(text(input, "name")))
    });
}

#[test]
fn conflict_copies() {
    kubuno_vectors::assert_suite(path("conflict-copy.json"), |input| {
        let stamp = ConflictStamp {
            machine: text(input, "machine"),
            year: number(input, "year") as i32,
            month: number(input, "month") as u32,
            day: number(input, "day") as u32,
            hour: number(input, "hour") as u32,
            minute: number(input, "minute") as u32,
        };
        let folder = input["folder"].as_bool().unwrap_or(false);
        json!(conflict_copy_name(text(input, "name"), folder, &stamp))
    });
}
