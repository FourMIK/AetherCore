#!/bin/bash
################################################################################
# AetherCore MDCA Field Deployment - Multi-Node Provisioning Harness
#
# Philosophy: "Trust at the Tactical Edge"
# Purpose: Automated provisioning of CodeRalphie swarm for field test
#
# Provisions multiple Raspberry Pi nodes with:
# - Hardware-rooted identity (TPM Ed25519)
# - Zero-touch enrollment
# - Fail-visible configuration
# - Contested RF resilience
# - Field test telemetry collection
#
# Usage: ./deploy-field-swarm.sh [config-file] [node-list-file]
# Example: ./deploy-field-swarm.sh ../config/mdca-field-test.yaml nodes.txt
################################################################################

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="${1:-$PROJECT_ROOT/config/mdca-field-test.yaml}"
NODES_FILE="${2:-./field-nodes.txt}"
LOG_DIR="${PROJECT_ROOT}/logs/field-deployment"
DEPLOYMENT_LOG="${LOG_DIR}/deployment-$(date +%Y%m%d-%H%M%S).log"

# Create log directory
mkdir -p "$LOG_DIR"

################################################################################
# LOGGING UTILITIES
################################################################################

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a "$DEPLOYMENT_LOG"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $*" | tee -a "$DEPLOYMENT_LOG"
}

log_success() {
  echo -e "${GREEN}[✓]${NC} $*" | tee -a "$DEPLOYMENT_LOG"
}

log_info() {
  echo -e "${BLUE}[INFO]${NC} $*" | tee -a "$DEPLOYMENT_LOG"
}

log_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $*" | tee -a "$DEPLOYMENT_LOG"
}

################################################################################
# VALIDATION CHECKS
################################################################################

validate_prerequisites() {
  log_info "=== VALIDATING PREREQUISITES ==="
  
  # Check for required tools
  local required_tools=("ssh" "scp" "git" "cargo")
  for tool in "${required_tools[@]}"; do
    if ! command -v "$tool" &> /dev/null; then
      log_error "Required tool not found: $tool"
      return 1
    fi
  done
  log_success "All required tools present"
  
  # Check configuration file
  if [[ ! -f "$CONFIG_FILE" ]]; then
    log_error "Configuration file not found: $CONFIG_FILE"
    return 1
  fi
  log_success "Configuration file found: $CONFIG_FILE"
  
  # Check nodes file
  if [[ ! -f "$NODES_FILE" ]]; then
    log_error "Nodes file not found: $NODES_FILE"
    return 1
  fi
  
  local node_count=$(grep -cv '^#' "$NODES_FILE" || echo 0)
  if [[ $node_count -eq 0 ]]; then
    log_error "No nodes defined in $NODES_FILE"
    return 1
  fi
  log_success "Found $node_count nodes for provisioning"
}

################################################################################
# BUILD ARTIFACTS
################################################################################

build_coderalphie_artifacts() {
  log_info "=== BUILDING CODERALPHIE ARTIFACTS ==="
  
  cd "$PROJECT_ROOT"
  
  # Build for ARM64 (Raspberry Pi)
  log_info "Building ARM64 binary..."
  cargo build --release \
    --target aarch64-unknown-linux-gnu \
    --features hardware-tpm \
    2>&1 | tee -a "$DEPLOYMENT_LOG"
  
  if [[ ! -f "target/aarch64-unknown-linux-gnu/release/coderalphie" ]]; then
    log_error "CodeRalphie ARM64 build failed"
    return 1
  fi
  log_success "ARM64 binary built successfully"
  
  # Build for x86_64 (if needed for bunker/test rig)
  log_info "Building x86_64 binary..."
  cargo build --release \
    --target x86_64-unknown-linux-gnu \
    --features hardware-tpm \
    2>&1 | tee -a "$DEPLOYMENT_LOG"
  
  log_success "x86_64 binary built successfully"
  
  # Package binaries and config
  local package_dir="dist/coderalphie-field-deploy"
  mkdir -p "$package_dir"
  
  cp "target/aarch64-unknown-linux-gnu/release/coderalphie" "$package_dir/coderalphie-arm64"
  cp "target/x86_64-unknown-linux-gnu/release/coderalphie" "$package_dir/coderalphie-x86_64"
  cp "$CONFIG_FILE" "$package_dir/field-config.yaml"
  cp "coderalphie/raspberry-pi/setup.sh" "$package_dir/"
  cp "coderalphie/raspberry-pi/deploy-ralphie.sh" "$package_dir/"
  cp "agent/linux/install.sh" "$package_dir/"
  
  log_success "Artifacts packaged to $package_dir"
  echo "$package_dir"
}

################################################################################
# NODE PROVISIONING
################################################################################

# Parse node definition: hostname[,user[,arch[,key_file]]]
parse_node_definition() {
  local node_def="$1"
  local IFS=','
  local -a parts=($node_def)
  
  echo "${parts[0]}"           # hostname
  echo "${parts[1]:-pi}"       # user (default: pi)
  echo "${parts[2]:-arm64}"    # arch (default: arm64)
  echo "${parts[3]:-}"         # key_file (optional)
}

provision_node() {
  local node_def="$1"
  local artifacts_dir="$2"
  local parallel_index="$3"
  local node_log="$LOG_DIR/node-${node_def%%,*}-$(date +%s).log"
  
  {
    log_info "Provisioning node: $node_def"
    
    # Parse node definition
    local hostname user arch key_file
    read -r hostname user arch key_file < <(parse_node_definition "$node_def")
    
    # Determine SSH key arguments
    local ssh_opts="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
    if [[ -n "$key_file" && -f "$key_file" ]]; then
      ssh_opts="$ssh_opts -i $key_file"
    fi
    
    # Health check - can we reach the node?
    log_info "Health check: $hostname"
    if ! ssh $ssh_opts "${user}@${hostname}" "echo 'SSH OK'" > /dev/null 2>&1; then
      log_error "Cannot reach node: $hostname"
      return 1
    fi
    log_success "SSH connectivity verified: $hostname"
    
    # Verify TPM availability
    log_info "Verifying TPM on $hostname"
    if ! ssh $ssh_opts "${user}@${hostname}" "ls -l /dev/tpm0" > /dev/null 2>&1; then
      log_error "TPM not available on $hostname"
      return 1
    fi
    log_success "TPM verified on $hostname"
    
    # Transfer artifacts
    log_info "Transferring artifacts to $hostname"
    scp $ssh_opts -r "${artifacts_dir}/"* "${user}@${hostname}:/tmp/aethercore/" 2>&1 | tee -a "$node_log"
    log_success "Artifacts transferred to $hostname"
    
    # Determine binary based on architecture
    local binary_name="coderalphie-arm64"
    [[ "$arch" == "x86_64" ]] && binary_name="coderalphie-x86_64"
    
    # Execute remote provisioning
    log_info "Executing provisioning on $hostname"
    ssh $ssh_opts "${user}@${hostname}" << 'REMOTE_PROVISION'
      set -e
      cd /tmp/aethercore
      
      # System hardening
      echo "[1/4] System hardening..."
      sudo ./setup.sh > /dev/null 2>&1
      
      # Install CodeRalphie
      echo "[2/4] Installing CodeRalphie..."
      sudo ./install.sh > /dev/null 2>&1
      
      # Configure field test settings
      echo "[3/4] Configuring field test mode..."
      sudo bash -c 'echo "AETHERCORE_PRODUCTION=1" >> /etc/environment'
      sudo cp field-config.yaml /etc/coderalphie/config.yaml
      sudo chown root:root /etc/coderalphie/config.yaml
      sudo chmod 644 /etc/coderalphie/config.yaml
      
      # Enable service and verify
      echo "[4/4] Starting service..."
      sudo systemctl restart coderalphie
      sudo systemctl status coderalphie --no-pager
      
      echo "=== PROVISIONING COMPLETE ==="
REMOTE_PROVISION
    
    log_success "Node provisioning complete: $hostname"
    
  } 2>&1 | tee -a "$node_log"
}

################################################################################
# BATCH PROVISIONING ORCHESTRATION
################################################################################

provision_field_swarm() {
  log_info "=== PROVISIONING FIELD SWARM ==="
  
  local artifacts_dir="$1"
  local max_parallel=5
  local active_jobs=0
  local failed_nodes=()
  local success_nodes=()
  
  while IFS= read -r node_def; do
    # Skip comments and empty lines
    [[ "$node_def" =~ ^#.*$ ]] && continue
    [[ -z "$node_def" ]] && continue
    
    # Wait for slots if at max parallel
    while [[ $(jobs -r -p | wc -l) -ge $max_parallel ]]; do
      sleep 1
    done
    
    # Provision in background
    provision_node "$node_def" "$artifacts_dir" "$active_jobs" &
    ((active_jobs++))
    
  done < "$NODES_FILE"
  
  # Wait for all background jobs
  log_info "Waiting for all provisioning jobs to complete..."
  local exit_code=0
  while IFS= read -r job_pid; do
    if ! wait "$job_pid"; then
      ((exit_code++))
    fi
  done < <(jobs -r -p)
  
  if [[ $exit_code -gt 0 ]]; then
    log_warning "$exit_code nodes failed to provision"
    return 1
  fi
  
  log_success "All nodes provisioned successfully"
}

################################################################################
# VERIFICATION & TESTING
################################################################################

verify_field_deployment() {
  log_info "=== VERIFYING FIELD DEPLOYMENT ==="
  
  local verification_log="$LOG_DIR/verification-$(date +%s).log"
  local healthy_nodes=0
  local unhealthy_nodes=0
  
  {
    while IFS= read -r node_def; do
      [[ "$node_def" =~ ^#.*$ ]] && continue
      [[ -z "$node_def" ]] && continue
      
      local hostname
      hostname=$(echo "$node_def" | cut -d',' -f1)
      
      log_info "Verifying node: $hostname"
      
      # Check service status
      if ssh -o ConnectTimeout=5 "pi@${hostname}" "systemctl is-active coderalphie" &>/dev/null; then
        # Get node identity
        local identity
        identity=$(ssh -o ConnectTimeout=5 "pi@${hostname}" \
          "journalctl -u coderalphie -n 10 --grep 'Identity' | tail -1" || echo "UNKNOWN")
        
        log_success "Node healthy: $hostname (Identity: ${identity:0:40}...)"
        ((healthy_nodes++))
      else
        log_error "Node unhealthy: $hostname"
        ((unhealthy_nodes++))
        
        # Show last 10 lines of logs for debugging
        log_info "Recent logs from $hostname:"
        ssh -o ConnectTimeout=5 "pi@${hostname}" \
          "journalctl -u coderalphie -n 10 --no-pager" 2>/dev/null || echo "Could not retrieve logs"
      fi
      
    done < "$NODES_FILE"
  } 2>&1 | tee -a "$verification_log"
  
  log_info "=== VERIFICATION SUMMARY ==="
  log_info "Healthy nodes: $healthy_nodes"
  log_info "Unhealthy nodes: $unhealthy_nodes"
  
  if [[ $unhealthy_nodes -gt 0 ]]; then
    return 1
  fi
}

################################################################################
# FIELD TEST READINESS CHECKLIST
################################################################################

field_readiness_checklist() {
  log_info "=== FIELD TEST READINESS CHECKLIST ==="
  
  local checklist=(
    "All CodeRalphie nodes provisioned and healthy"
    "TPM hardware integrity verified on all nodes"
    "Zero-touch enrollment completed (identities registered)"
    "Merkle Vine integrity chains initialized"
    "Byzantine sweep monitoring active"
    "Contested RF mode enabled in all nodes"
    "Offline mesh coordination ready"
    "Field telemetry collection configured"
    "Tactical Glass dashboard connected to C2 router"
    "operator runbook distributed to field team"
  )
  
  local index=1
  for item in "${checklist[@]}"; do
    echo "[ ] $index. $item"
    ((index++))
  done
  
  log_info ""
  log_info "Complete the checklist above before starting field test."
  log_info "Readiness documentation: $PROJECT_ROOT/docs/FIELD_TEST_READINESS.md"
}

################################################################################
# MAIN EXECUTION
################################################################################

main() {
  log "╔════════════════════════════════════════════════════════════════╗"
  log "║     AetherCore MDCA Field Deployment - Swarm Provisioning      ║"
  log "║     Philosophy: \"Trust at the Tactical Edge\"                   ║"
  log "╚════════════════════════════════════════════════════════════════╝"
  log ""
  
  # Validation
  if ! validate_prerequisites; then
    log_error "Prerequisites validation failed"
    exit 1
  fi
  log ""
  
  # Build artifacts
  local artifacts_dir
  if ! artifacts_dir=$(build_coderalphie_artifacts); then
    log_error "Build failed"
    exit 1
  fi
  log ""
  
  # Provision swarm
  if ! provision_field_swarm "$artifacts_dir"; then
    log_error "Swarm provisioning failed"
    exit 1
  fi
  log ""
  
  # Verify deployment
  if ! verify_field_deployment; then
    log_warning "Some nodes failed verification"
  fi
  log ""
  
  # Readiness checklist
  field_readiness_checklist
  log ""
  
  log_success "Deployment complete. Logs written to: $LOG_DIR"
}

main "$@"
