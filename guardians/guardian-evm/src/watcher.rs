use guardian_core::types::Observation;
use anyhow::Result;

pub struct EVMWatcher {
    pub chain_id: u16,
}

impl EVMWatcher {
    pub fn new(chain_id: u16) -> Self {
        Self { chain_id }
    }
    
    pub async fn watch(&self) -> Result<Vec<Observation>> {
        Ok(vec![])
    }
}

