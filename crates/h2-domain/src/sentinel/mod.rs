//! Sentinel alert correlation and escalation engine
//!
//! Provides alert correlation, cross-domain grouping, and escalation
//! workflow management for operational alerts.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::alarms::{AlertCategory, AlertSeverity, AttestedAlert};

/// Alert group for correlation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertGroup {
    /// Unique group identifier
    pub group_id: String,

    /// Group category
    pub category: AlertCategory,

    /// Highest severity in group
    pub max_severity: AlertSeverity,

    /// Alert IDs in this group
    pub alert_ids: Vec<String>,

    /// Creation timestamp
    pub created_at: u64,

    /// Last update timestamp
    pub updated_at: u64,

    /// Escalation level (0 = none, higher = more escalated)
    pub escalation_level: u32,
}

impl AlertGroup {
    /// Create a new alert group
    pub fn new(group_id: String, category: AlertCategory, timestamp: u64) -> Self {
        Self {
            group_id,
            category,
            max_severity: AlertSeverity::Info,
            alert_ids: Vec::new(),
            created_at: timestamp,
            updated_at: timestamp,
            escalation_level: 0,
        }
    }

    /// Add an alert to the group
    pub fn add_alert(&mut self, alert_id: String, severity: AlertSeverity, timestamp: u64) {
        self.alert_ids.push(alert_id);
        self.updated_at = timestamp;

        // Update max severity
        if severity.is_critical() {
            self.max_severity = AlertSeverity::Critical;
        } else if self.max_severity == AlertSeverity::Info {
            self.max_severity = severity;
        }
    }

    /// Escalate the group
    pub fn escalate(&mut self, timestamp: u64) {
        self.escalation_level += 1;
        self.updated_at = timestamp;
    }

    /// Check if group needs escalation
    pub fn needs_escalation(&self, threshold_count: usize) -> bool {
        self.alert_ids.len() >= threshold_count || self.max_severity.is_critical()
    }
}

/// Escalation workflow definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscalationWorkflow {
    /// Workflow identifier
    pub workflow_id: String,

    /// Alert category this workflow applies to
    pub category: AlertCategory,

    /// Escalation thresholds (alert count, time in minutes)
    pub thresholds: Vec<(usize, u64)>,

    /// Notification targets by escalation level
    pub notification_targets: HashMap<u32, Vec<String>>,
}

impl EscalationWorkflow {
    /// Create a new escalation workflow
    pub fn new(workflow_id: String, category: AlertCategory) -> Self {
        Self {
            workflow_id,
            category,
            thresholds: Vec::new(),
            notification_targets: HashMap::new(),
        }
    }

    /// Add an escalation threshold
    pub fn add_threshold(&mut self, alert_count: usize, time_minutes: u64) {
        self.thresholds.push((alert_count, time_minutes));
    }

    /// Add notification targets for an escalation level
    pub fn add_notification_targets(&mut self, level: u32, targets: Vec<String>) {
        self.notification_targets.insert(level, targets);
    }

    /// Determine if escalation is needed
    pub fn should_escalate(
        &self,
        current_level: u32,
        alert_count: usize,
        age_minutes: u64,
    ) -> bool {
        if let Some(&(threshold_count, threshold_time)) =
            self.thresholds.get(current_level as usize)
        {
            alert_count >= threshold_count || age_minutes >= threshold_time
        } else {
            false
        }
    }
}

/// Sentinel engine for alert correlation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentinelEngine {
    /// Map of group ID to alert group
    groups: HashMap<String, AlertGroup>,

    /// Map of alert ID to group ID
    alert_to_group: HashMap<String, String>,

    /// Escalation workflows by category
    workflows: HashMap<AlertCategory, EscalationWorkflow>,

    /// Correlation time window in milliseconds
    correlation_window_ms: u64,
}

impl SentinelEngine {
    /// Create a new sentinel engine
    pub fn new() -> Self {
        Self {
            groups: HashMap::new(),
            alert_to_group: HashMap::new(),
            workflows: HashMap::new(),
            correlation_window_ms: 5 * 60 * 1000, // 5 minutes default
        }
    }

    /// Create with custom correlation window
    pub fn with_correlation_window(correlation_window_ms: u64) -> Self {
        Self {
            groups: HashMap::new(),
            alert_to_group: HashMap::new(),
            workflows: HashMap::new(),
            correlation_window_ms,
        }
    }

    /// Ingest an alert and correlate it
    pub fn ingest_alert(&mut self, alert: &AttestedAlert) -> Option<String> {
        // Find or create group for this category
        let group_id = self.find_or_create_group(alert.category, alert.timestamp_ms);

        // Add alert to group
        if let Some(group) = self.groups.get_mut(&group_id) {
            group.add_alert(alert.alert_id.clone(), alert.severity, alert.timestamp_ms);
            self.alert_to_group
                .insert(alert.alert_id.clone(), group_id.clone());
        }

        Some(group_id)
    }

    /// Find or create an alert group for a category
    fn find_or_create_group(&mut self, category: AlertCategory, timestamp: u64) -> String {
        // Look for existing group within correlation window
        for (group_id, group) in &self.groups {
            if group.category == category
                && timestamp.saturating_sub(group.updated_at) <= self.correlation_window_ms
            {
                return group_id.clone();
            }
        }

        // Create new group
        let group_id = format!("group-{}-{}", category as u8, timestamp);
        let group = AlertGroup::new(group_id.clone(), category, timestamp);
        self.groups.insert(group_id.clone(), group);
        group_id
    }

    /// Register an escalation workflow
    pub fn register_workflow(&mut self, workflow: EscalationWorkflow) {
        self.workflows.insert(workflow.category, workflow);
    }

    /// Process escalations
    pub fn process_escalations(&mut self, current_time_ms: u64) -> Vec<(String, u32)> {
        let mut escalations = Vec::new();

        for (group_id, group) in &mut self.groups {
            if let Some(workflow) = self.workflows.get(&group.category) {
                let age_minutes = current_time_ms.saturating_sub(group.created_at) / (60 * 1000);

                if workflow.should_escalate(
                    group.escalation_level,
                    group.alert_ids.len(),
                    age_minutes,
                ) {
                    group.escalate(current_time_ms);
                    escalations.push((group_id.clone(), group.escalation_level));
                }
            }
        }

        escalations
    }

    /// Get an alert group
    pub fn get_group(&self, group_id: &str) -> Option<&AlertGroup> {
        self.groups.get(group_id)
    }

    /// Get all groups
    pub fn all_groups(&self) -> impl Iterator<Item = &AlertGroup> {
        self.groups.values()
    }

    /// Get groups by category
    pub fn groups_by_category(&self, category: AlertCategory) -> Vec<&AlertGroup> {
        self.groups
            .values()
            .filter(|g| g.category == category)
            .collect()
    }

    /// Get total group count
    pub fn total_groups(&self) -> usize {
        self.groups.len()
    }
}

impl Default for SentinelEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_alert_group_creation() {
        let group = AlertGroup::new("group-001".to_string(), AlertCategory::AssetDegraded, 1000);

        assert_eq!(group.group_id, "group-001");
        assert_eq!(group.escalation_level, 0);
        assert!(group.alert_ids.is_empty());
    }

    #[test]
    fn test_alert_group_add_alert() {
        let mut group =
            AlertGroup::new("group-001".to_string(), AlertCategory::AssetDegraded, 1000);

        group.add_alert("alert-001".to_string(), AlertSeverity::Warning, 2000);
        assert_eq!(group.alert_ids.len(), 1);
        assert_eq!(group.max_severity, AlertSeverity::Warning);
    }

    #[test]
    fn test_alert_group_escalate() {
        let mut group =
            AlertGroup::new("group-001".to_string(), AlertCategory::AssetDegraded, 1000);

        group.escalate(2000);
        assert_eq!(group.escalation_level, 1);
        assert_eq!(group.updated_at, 2000);
    }

    #[test]
    fn test_alert_group_needs_escalation() {
        let mut group =
            AlertGroup::new("group-001".to_string(), AlertCategory::AssetDegraded, 1000);

        assert!(!group.needs_escalation(3));

        group.add_alert("alert-001".to_string(), AlertSeverity::Warning, 2000);
        group.add_alert("alert-002".to_string(), AlertSeverity::Warning, 3000);
        group.add_alert("alert-003".to_string(), AlertSeverity::Warning, 4000);

        assert!(group.needs_escalation(3));
    }

    #[test]
    fn test_escalation_workflow_creation() {
        let workflow =
            EscalationWorkflow::new("workflow-001".to_string(), AlertCategory::AssetDegraded);

        assert_eq!(workflow.workflow_id, "workflow-001");
        assert!(workflow.thresholds.is_empty());
    }

    #[test]
    fn test_escalation_workflow_add_threshold() {
        let mut workflow =
            EscalationWorkflow::new("workflow-001".to_string(), AlertCategory::AssetDegraded);

        workflow.add_threshold(3, 5);
        assert_eq!(workflow.thresholds.len(), 1);
    }

    #[test]
    fn test_escalation_workflow_should_escalate() {
        let mut workflow =
            EscalationWorkflow::new("workflow-001".to_string(), AlertCategory::AssetDegraded);

        workflow.add_threshold(3, 5);

        assert!(workflow.should_escalate(0, 3, 0));
        assert!(workflow.should_escalate(0, 0, 5));
        assert!(!workflow.should_escalate(0, 2, 4));
    }

    #[test]
    fn test_sentinel_engine_creation() {
        let engine = SentinelEngine::new();
        assert_eq!(engine.total_groups(), 0);
    }

    #[test]
    fn test_sentinel_engine_ingest_alert() {
        let mut engine = SentinelEngine::new();

        let alert = AttestedAlert::new(
            "alert-001".to_string(),
            AlertSeverity::Warning,
            AlertCategory::AssetDegraded,
            "Test alert".to_string(),
            1000,
            vec![0u8; 32],
            0.8,
        );

        let group_id = engine.ingest_alert(&alert);
        assert!(group_id.is_some());
        assert_eq!(engine.total_groups(), 1);
    }

    #[test]
    fn test_sentinel_engine_correlation() {
        let mut engine = SentinelEngine::with_correlation_window(5000);

        let alert1 = AttestedAlert::new(
            "alert-001".to_string(),
            AlertSeverity::Warning,
            AlertCategory::AssetDegraded,
            "Test alert 1".to_string(),
            1000,
            vec![0u8; 32],
            0.8,
        );

        let alert2 = AttestedAlert::new(
            "alert-002".to_string(),
            AlertSeverity::Warning,
            AlertCategory::AssetDegraded,
            "Test alert 2".to_string(),
            2000,
            vec![0u8; 32],
            0.8,
        );

        let group1 = engine.ingest_alert(&alert1).unwrap();
        let group2 = engine.ingest_alert(&alert2).unwrap();

        // Should be in same group (within correlation window)
        assert_eq!(group1, group2);
        assert_eq!(engine.total_groups(), 1);
    }

    #[test]
    fn test_sentinel_engine_process_escalations() {
        let mut engine = SentinelEngine::new();

        let mut workflow =
            EscalationWorkflow::new("workflow-001".to_string(), AlertCategory::AssetDegraded);
        workflow.add_threshold(2, 5);
        engine.register_workflow(workflow);

        let alert1 = AttestedAlert::new(
            "alert-001".to_string(),
            AlertSeverity::Warning,
            AlertCategory::AssetDegraded,
            "Test alert 1".to_string(),
            1000,
            vec![0u8; 32],
            0.8,
        );

        let alert2 = AttestedAlert::new(
            "alert-002".to_string(),
            AlertSeverity::Warning,
            AlertCategory::AssetDegraded,
            "Test alert 2".to_string(),
            2000,
            vec![0u8; 32],
            0.8,
        );

        engine.ingest_alert(&alert1);
        engine.ingest_alert(&alert2);

        let escalations = engine.process_escalations(3000);
        assert_eq!(escalations.len(), 1);
    }

    #[test]
    fn test_sentinel_engine_groups_by_category() {
        let mut engine = SentinelEngine::new();

        let alert1 = AttestedAlert::new(
            "alert-001".to_string(),
            AlertSeverity::Warning,
            AlertCategory::AssetDegraded,
            "Test alert 1".to_string(),
            1000,
            vec![0u8; 32],
            0.8,
        );

        let alert2 = AttestedAlert::new(
            "alert-002".to_string(),
            AlertSeverity::Warning,
            AlertCategory::AssetOffline,
            "Test alert 2".to_string(),
            2000,
            vec![0u8; 32],
            0.8,
        );

        engine.ingest_alert(&alert1);
        engine.ingest_alert(&alert2);

        let degraded_groups = engine.groups_by_category(AlertCategory::AssetDegraded);
        assert_eq!(degraded_groups.len(), 1);
    }
}
