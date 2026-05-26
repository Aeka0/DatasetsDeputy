use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const HISTORY_MAX_OPERATIONS: usize = 100;
pub const HISTORY_MAX_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryOperation {
    pub id: u64,
    pub label: String,
    pub resources: Vec<String>,
    pub size_bytes: u64,
    pub payload: Value,
    pub persisted: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewHistoryOperation {
    pub label: String,
    pub resources: Vec<String>,
    pub size_bytes: u64,
    pub payload: Value,
    pub persisted: bool,
    #[serde(default)]
    pub replace_draft_resources: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryState {
    pub can_undo: bool,
    pub can_redo: bool,
    pub undo_label: Option<String>,
    pub redo_label: Option<String>,
    pub operation_count: usize,
    pub size_bytes: u64,
    pub max_operations: usize,
    pub max_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRecordResult {
    pub state: HistoryState,
    pub recorded: bool,
    pub oversized: bool,
    pub trimmed: usize,
}

#[derive(Default)]
pub struct HistoryManager {
    next_id: u64,
    undo_stack: Vec<HistoryOperation>,
    redo_stack: Vec<HistoryOperation>,
}

impl HistoryManager {
    pub fn state(&self) -> HistoryState {
        HistoryState {
            can_undo: !self.undo_stack.is_empty(),
            can_redo: !self.redo_stack.is_empty(),
            undo_label: self
                .undo_stack
                .last()
                .map(|operation| operation.label.clone()),
            redo_label: self
                .redo_stack
                .last()
                .map(|operation| operation.label.clone()),
            operation_count: self.undo_stack.len() + self.redo_stack.len(),
            size_bytes: self
                .undo_stack
                .iter()
                .chain(self.redo_stack.iter())
                .map(|operation| operation.size_bytes)
                .sum(),
            max_operations: HISTORY_MAX_OPERATIONS,
            max_bytes: HISTORY_MAX_BYTES,
        }
    }

    pub fn record(&mut self, input: NewHistoryOperation) -> HistoryRecordResult {
        if input.size_bytes > HISTORY_MAX_BYTES {
            return HistoryRecordResult {
                state: self.state(),
                recorded: false,
                oversized: true,
                trimmed: 0,
            };
        }

        if !input.replace_draft_resources.is_empty() {
            let resources = input
                .replace_draft_resources
                .iter()
                .cloned()
                .collect::<HashSet<_>>();
            self.undo_stack.retain(|operation| {
                operation.persisted
                    || !operation
                        .resources
                        .iter()
                        .any(|resource| resources.contains(resource))
            });
        }

        self.next_id += 1;
        self.undo_stack.push(HistoryOperation {
            id: self.next_id,
            label: input.label,
            resources: input.resources,
            size_bytes: input.size_bytes,
            payload: input.payload,
            persisted: input.persisted,
        });
        self.redo_stack.clear();

        let mut trimmed = 0;
        while self.undo_stack.len() > HISTORY_MAX_OPERATIONS
            || self
                .undo_stack
                .iter()
                .map(|operation| operation.size_bytes)
                .sum::<u64>()
                > HISTORY_MAX_BYTES
        {
            self.undo_stack.remove(0);
            trimmed += 1;
        }

        HistoryRecordResult {
            state: self.state(),
            recorded: true,
            oversized: false,
            trimmed,
        }
    }

    pub fn discard_redo(&mut self) -> Vec<HistoryOperation> {
        self.redo_stack.drain(..).collect()
    }

    pub fn undo(&mut self) -> Option<(HistoryOperation, HistoryState)> {
        let operation = self.undo_stack.pop()?;
        self.redo_stack.push(operation.clone());
        Some((operation, self.state()))
    }

    pub fn redo(&mut self) -> Option<(HistoryOperation, HistoryState)> {
        let operation = self.redo_stack.pop()?;
        self.undo_stack.push(operation.clone());
        Some((operation, self.state()))
    }

    pub fn invalidate_resources(
        &mut self,
        invalidated: &[String],
    ) -> (HistoryState, Vec<HistoryOperation>) {
        let invalidated = invalidated.iter().collect::<Vec<_>>();
        let intersects = |operation: &HistoryOperation| {
            operation.resources.iter().any(|resource| {
                invalidated.iter().any(|invalid| {
                    resource == *invalid
                        || resource.starts_with(&format!("{invalid}/"))
                        || invalid.starts_with(&format!("{resource}/"))
                })
            })
        };
        let mut removed = Vec::new();
        self.undo_stack.retain(|operation| {
            if intersects(operation) {
                removed.push(operation.clone());
                false
            } else {
                true
            }
        });
        self.redo_stack.retain(|operation| {
            if intersects(operation) {
                removed.push(operation.clone());
                false
            } else {
                true
            }
        });
        (self.state(), removed)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn operation(
        label: &str,
        resource: &str,
        size_bytes: u64,
        persisted: bool,
    ) -> NewHistoryOperation {
        NewHistoryOperation {
            label: label.to_owned(),
            resources: vec![resource.to_owned()],
            size_bytes,
            payload: json!({ "kind": "text" }),
            persisted,
            replace_draft_resources: Vec::new(),
        }
    }

    #[test]
    fn records_undo_and_redo_in_order() {
        let mut manager = HistoryManager::default();
        manager.record(operation("A", "image:1", 10, true));
        manager.record(operation("B", "image:2", 10, true));

        assert_eq!(manager.undo().unwrap().0.label, "B");
        assert_eq!(manager.redo().unwrap().0.label, "B");
        assert_eq!(manager.state().undo_label.as_deref(), Some("B"));
    }

    #[test]
    fn saved_operation_compacts_matching_drafts() {
        let mut manager = HistoryManager::default();
        manager.record(operation("draft A", "cell:1", 10, false));
        manager.record(operation("draft B", "cell:2", 10, false));
        let mut saved = operation("save", "cell:1", 10, true);
        saved.replace_draft_resources = vec!["cell:1".to_owned()];
        manager.record(saved);

        assert_eq!(manager.state().operation_count, 2);
    }

    #[test]
    fn invalidation_removes_only_intersecting_resources() {
        let mut manager = HistoryManager::default();
        manager.record(operation("A", "dataset:1/image:1", 10, true));
        manager.record(operation("B", "dataset:2/image:1", 10, true));
        manager.invalidate_resources(&["dataset:1".to_owned()]);

        assert_eq!(manager.state().operation_count, 1);
        assert_eq!(manager.state().undo_label.as_deref(), Some("B"));
    }

    #[test]
    fn rejects_single_oversized_operation() {
        let mut manager = HistoryManager::default();
        let result = manager.record(operation("large", "image:1", HISTORY_MAX_BYTES + 1, true));

        assert!(!result.recorded);
        assert!(result.oversized);
    }

    #[test]
    fn redo_operations_still_count_towards_capacity() {
        let mut manager = HistoryManager::default();
        manager.record(operation("A", "image:1", 10, true));
        manager.undo();

        assert_eq!(manager.state().operation_count, 1);
        assert_eq!(manager.state().size_bytes, 10);
    }
}
