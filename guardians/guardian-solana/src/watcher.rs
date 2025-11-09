use guardian_core::types::Observation;
use anyhow::Result;

pub struct SolanaWatcher {
    pub chain_id: u16,
}

impl SolanaWatcher {
    pub fn new(chain_id: u16) -> Self {
        Self { chain_id }
    }
    
    pub async fn watch(&self) -> Result<Vec<Observation>> {
        Ok(vec![])
    }
}

