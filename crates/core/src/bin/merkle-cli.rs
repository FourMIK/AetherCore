//! Merkle CLI Tool
//!
//! Command-line interface for building Merkle trees, generating proofs,
//! and verifying proofs independently of the backend service.

use aethercore_core::{preprocess_leaves, MerkleProof, MerkleTree};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, BufRead};
use std::path::PathBuf;
use std::process;

/// Serializable tree info for CLI
#[derive(Debug, Serialize, Deserialize)]
struct TreeInfo {
    root_hash: String,
    leaf_count: usize,
    leaves: Vec<String>,
}

/// JSON output for build command
#[derive(Debug, Serialize)]
struct BuildOutput {
    root_hash: String,
    leaf_count: usize,
    success: bool,
}

/// JSON output for prove command
#[derive(Debug, Serialize)]
struct ProveOutput {
    leaf_hash: String,
    leaf_index: usize,
    root_hash: String,
    sibling_count: usize,
    success: bool,
}

/// JSON output for verify command
#[derive(Debug, Serialize)]
struct VerifyOutput {
    valid: bool,
    leaf_hash: String,
    root_hash: String,
    message: String,
}

fn read_hashes_from_file(path: &PathBuf) -> io::Result<Vec<Vec<u8>>> {
    let file = fs::File::open(path)?;
    let reader = io::BufReader::new(file);
    let mut hashes = Vec::new();

    for line in reader.lines() {
        let line = line?;
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Try to parse as hex
        if let Ok(bytes) = hex::decode(line) {
            hashes.push(bytes);
        } else {
            // Use raw bytes
            hashes.push(line.as_bytes().to_vec());
        }
    }

    Ok(hashes)
}

fn cmd_build(input: PathBuf, output: Option<PathBuf>, json: bool) -> Result<(), String> {
    let hashes =
        read_hashes_from_file(&input).map_err(|e| format!("Failed to read input: {}", e))?;

    if hashes.is_empty() {
        return Err("No hashes found in input file".to_string());
    }

    let sorted_leaves = preprocess_leaves(&hashes);
    let tree = MerkleTree::build(sorted_leaves.clone())
        .map_err(|e| format!("Failed to build tree: {}", e))?;

    let root_hash_hex = hex::encode(tree.root());

    if json {
        let output_data = BuildOutput {
            root_hash: root_hash_hex.clone(),
            leaf_count: tree.leaf_count(),
            success: true,
        };
        println!("{}", serde_json::to_string_pretty(&output_data).unwrap());
    } else {
        println!("Root hash: {}", root_hash_hex);
        println!("Leaf count: {}", tree.leaf_count());
    }

    if let Some(output_path) = output {
        let tree_info = TreeInfo {
            root_hash: root_hash_hex,
            leaf_count: tree.leaf_count(),
            leaves: sorted_leaves.iter().map(|h| hex::encode(h)).collect(),
        };

        let json_str = serde_json::to_string_pretty(&tree_info)
            .map_err(|e| format!("Failed to serialize tree: {}", e))?;
        fs::write(&output_path, json_str).map_err(|e| format!("Failed to write output: {}", e))?;

        if !json {
            println!("Tree saved to: {}", output_path.display());
        }
    }

    Ok(())
}

fn cmd_prove(
    tree_path: PathBuf,
    leaf_index: usize,
    output: Option<PathBuf>,
    json: bool,
) -> Result<(), String> {
    let tree_json =
        fs::read_to_string(&tree_path).map_err(|e| format!("Failed to read tree file: {}", e))?;
    let tree_info: TreeInfo = serde_json::from_str(&tree_json)
        .map_err(|e| format!("Failed to parse tree file: {}", e))?;

    let leaves: Vec<[u8; 32]> = tree_info
        .leaves
        .iter()
        .map(|h| {
            let bytes = hex::decode(h).unwrap();
            let mut hash = [0u8; 32];
            hash.copy_from_slice(&bytes);
            hash
        })
        .collect();

    let tree = MerkleTree::build(leaves).map_err(|e| format!("Failed to rebuild tree: {}", e))?;

    let proof = tree
        .generate_proof(leaf_index)
        .map_err(|e| format!("Failed to generate proof: {}", e))?;

    if json {
        let output_data = ProveOutput {
            leaf_hash: hex::encode(proof.leaf_hash),
            leaf_index: proof.leaf_index,
            root_hash: hex::encode(proof.root_hash),
            sibling_count: proof.sibling_hashes.len(),
            success: true,
        };
        println!("{}", serde_json::to_string_pretty(&output_data).unwrap());
    } else {
        println!("Proof generated for leaf {}", leaf_index);
        println!("Leaf hash: {}", hex::encode(proof.leaf_hash));
        println!("Root hash: {}", hex::encode(proof.root_hash));
        println!("Sibling count: {}", proof.sibling_hashes.len());
    }

    if let Some(output_path) = output {
        #[derive(Serialize)]
        struct ProofFile {
            leaf_hash: String,
            leaf_index: usize,
            root_hash: String,
            sibling_hashes: Vec<String>,
            direction_bits: Vec<bool>,
        }

        let proof_file = ProofFile {
            leaf_hash: hex::encode(proof.leaf_hash),
            leaf_index: proof.leaf_index,
            root_hash: hex::encode(proof.root_hash),
            sibling_hashes: proof
                .sibling_hashes
                .iter()
                .map(|h| hex::encode(h))
                .collect(),
            direction_bits: proof.direction_bits,
        };

        let json_str = serde_json::to_string_pretty(&proof_file)
            .map_err(|e| format!("Failed to serialize proof: {}", e))?;
        fs::write(&output_path, json_str).map_err(|e| format!("Failed to write proof: {}", e))?;

        if !json {
            println!("Proof saved to: {}", output_path.display());
        }
    }

    Ok(())
}

fn cmd_verify(proof_path: PathBuf, json: bool) -> Result<(), String> {
    let proof_json =
        fs::read_to_string(&proof_path).map_err(|e| format!("Failed to read proof file: {}", e))?;

    #[derive(Deserialize)]
    struct ProofFile {
        leaf_hash: String,
        leaf_index: usize,
        root_hash: String,
        sibling_hashes: Vec<String>,
        direction_bits: Vec<bool>,
    }

    let proof_file: ProofFile = serde_json::from_str(&proof_json)
        .map_err(|e| format!("Failed to parse proof file: {}", e))?;

    let leaf_hash = {
        let bytes = hex::decode(&proof_file.leaf_hash).map_err(|_| "Invalid leaf hash hex")?;
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&bytes);
        hash
    };

    let root_hash = {
        let bytes = hex::decode(&proof_file.root_hash).map_err(|_| "Invalid root hash hex")?;
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&bytes);
        hash
    };

    let sibling_hashes: Result<Vec<[u8; 32]>, String> = proof_file
        .sibling_hashes
        .iter()
        .map(|h| {
            let bytes = hex::decode(h).map_err(|_| "Invalid sibling hash hex")?;
            let mut hash = [0u8; 32];
            hash.copy_from_slice(&bytes);
            Ok(hash)
        })
        .collect();

    let sibling_hashes = sibling_hashes?;

    let proof = MerkleProof {
        leaf_hash,
        leaf_index: proof_file.leaf_index,
        sibling_hashes,
        direction_bits: proof_file.direction_bits,
        root_hash,
    };

    let result = MerkleTree::verify_proof(&proof);

    match result {
        Ok(true) => {
            if json {
                let output = VerifyOutput {
                    valid: true,
                    leaf_hash: hex::encode(proof.leaf_hash),
                    root_hash: hex::encode(proof.root_hash),
                    message: "Proof is valid".to_string(),
                };
                println!("{}", serde_json::to_string_pretty(&output).unwrap());
            } else {
                println!("✓ Proof is VALID");
                println!("  Leaf: {}", hex::encode(proof.leaf_hash));
                println!("  Root: {}", hex::encode(proof.root_hash));
            }
            Ok(())
        }
        Ok(false) => {
            if json {
                let output = VerifyOutput {
                    valid: false,
                    leaf_hash: hex::encode(proof.leaf_hash),
                    root_hash: hex::encode(proof.root_hash),
                    message: "Proof is invalid".to_string(),
                };
                println!("{}", serde_json::to_string_pretty(&output).unwrap());
            } else {
                println!("✗ Proof is INVALID");
            }
            Err("Proof verification failed".to_string())
        }
        Err(e) => {
            if json {
                let output = VerifyOutput {
                    valid: false,
                    leaf_hash: hex::encode(proof.leaf_hash),
                    root_hash: hex::encode(proof.root_hash),
                    message: format!("Verification error: {}", e),
                };
                println!("{}", serde_json::to_string_pretty(&output).unwrap());
            } else {
                println!("✗ Verification ERROR: {}", e);
            }
            Err(format!("Verification error: {}", e))
        }
    }
}

fn parse_args() -> Result<(String, Vec<String>), String> {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        return Err("Usage: merkle-cli <command> [options]".to_string());
    }

    Ok((args[1].clone(), args[2..].to_vec()))
}

fn print_usage() {
    println!("Merkle CLI - Build and verify Merkle trees");
    println!();
    println!("USAGE:");
    println!("    merkle-cli build --input <file> [--output <file>] [--json]");
    println!("    merkle-cli prove --tree <file> --leaf-index <n> [--output <file>] [--json]");
    println!("    merkle-cli verify --proof <file> [--json]");
    println!();
    println!("COMMANDS:");
    println!("    build     Build a Merkle tree from event hashes");
    println!("    prove     Generate a proof for a specific leaf");
    println!("    verify    Verify a Merkle proof");
    println!();
    println!("EXAMPLES:");
    println!("    merkle-cli build --input hashes.txt --output tree.json");
    println!("    merkle-cli prove --tree tree.json --leaf-index 42 --output proof.json");
    println!("    merkle-cli verify --proof proof.json");
}

fn main() {
    let (command, args) = match parse_args() {
        Ok(cmd) => cmd,
        Err(e) => {
            eprintln!("Error: {}", e);
            println!();
            print_usage();
            process::exit(1);
        }
    };

    let result = match command.as_str() {
        "build" => {
            let mut input = None;
            let mut output = None;
            let mut json = false;

            let mut i = 0;
            while i < args.len() {
                match args[i].as_str() {
                    "--input" | "-i" => {
                        i += 1;
                        if i < args.len() {
                            input = Some(PathBuf::from(&args[i]));
                        }
                    }
                    "--output" | "-o" => {
                        i += 1;
                        if i < args.len() {
                            output = Some(PathBuf::from(&args[i]));
                        }
                    }
                    "--json" => json = true,
                    _ => {}
                }
                i += 1;
            }

            match input {
                Some(input) => cmd_build(input, output, json),
                None => Err("Missing --input argument".to_string()),
            }
        }
        "prove" => {
            let mut tree = None;
            let mut leaf_index = None;
            let mut output = None;
            let mut json = false;

            let mut i = 0;
            while i < args.len() {
                match args[i].as_str() {
                    "--tree" | "-t" => {
                        i += 1;
                        if i < args.len() {
                            tree = Some(PathBuf::from(&args[i]));
                        }
                    }
                    "--leaf-index" | "-l" => {
                        i += 1;
                        if i < args.len() {
                            leaf_index = Some(args[i].parse().ok());
                        }
                    }
                    "--output" | "-o" => {
                        i += 1;
                        if i < args.len() {
                            output = Some(PathBuf::from(&args[i]));
                        }
                    }
                    "--json" => json = true,
                    _ => {}
                }
                i += 1;
            }

            match (tree, leaf_index.flatten()) {
                (Some(tree), Some(idx)) => cmd_prove(tree, idx, output, json),
                (None, _) => Err("Missing --tree argument".to_string()),
                (_, None) => Err("Missing or invalid --leaf-index argument".to_string()),
            }
        }
        "verify" => {
            let mut proof = None;
            let mut json = false;

            let mut i = 0;
            while i < args.len() {
                match args[i].as_str() {
                    "--proof" | "-p" => {
                        i += 1;
                        if i < args.len() {
                            proof = Some(PathBuf::from(&args[i]));
                        }
                    }
                    "--json" => json = true,
                    _ => {}
                }
                i += 1;
            }

            match proof {
                Some(proof) => cmd_verify(proof, json),
                None => Err("Missing --proof argument".to_string()),
            }
        }
        _ => {
            print_usage();
            Err(format!("Unknown command: {}", command))
        }
    };

    if let Err(e) = result {
        eprintln!("Error: {}", e);
        process::exit(1);
    }
}
