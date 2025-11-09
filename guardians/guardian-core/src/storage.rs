use crate::types::{Observation, Signature, VAA, VAAStatus};
use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct MockStorage {
    observations: Arc<RwLock<HashMap<[u8; 32], Observation>>>,
    signatures: Arc<RwLock<HashMap<[u8; 32], Vec<Signature>>>>,
    vaas: Arc<RwLock<HashMap<[u8; 32], VAA>>>,
}

impl MockStorage {
    pub fn new() -> Self {
        Self {
            observations: Arc::new(RwLock::new(HashMap::new())),
            signatures: Arc::new(RwLock::new(HashMap::new())),
            vaas: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    pub async fn store_observation(&self, observation: Observation) -> Result<()> {
        let hash = observation.hash();
        self.observations.write().await.insert(hash, observation);
        Ok(())
    }
    
    pub async fn get_observation(&self, hash: &[u8; 32]) -> Option<Observation> {
        self.observations.read().await.get(hash).cloned()
    }
    
    pub async fn store_signature(&self, message_hash: [u8; 32], signature: Signature) -> Result<()> {
        let mut sigs = self.signatures.write().await;
        sigs.entry(message_hash).or_insert_with(Vec::new).push(signature);
        Ok(())
    }
    
    pub async fn get_signatures(&self, message_hash: &[u8; 32]) -> Vec<Signature> {
        self.signatures.read().await
            .get(message_hash)
            .cloned()
            .unwrap_or_default()
    }
    
    pub async fn signature_count(&self, message_hash: &[u8; 32]) -> usize {
        self.signatures.read().await
            .get(message_hash)
            .map(|s| s.len())
            .unwrap_or(0)
    }
    
    pub async fn store_vaa(&self, vaa: VAA) -> Result<()> {
        let hash = vaa.message_hash();
        self.vaas.write().await.insert(hash, vaa);
        Ok(())
    }
    
    pub async fn get_vaa(&self, message_hash: &[u8; 32]) -> Option<VAA> {
        self.vaas.read().await.get(message_hash).cloned()
    }
    
    pub async fn get_vaa_status(&self, message_hash: &[u8; 32]) -> VAAStatus {
        let sig_count = self.signature_count(message_hash).await;
        
        if self.vaas.read().await.contains_key(message_hash) {
            VAAStatus::Ready
        } else if sig_count > 0 {
            VAAStatus::Aggregating {
                current: sig_count,
                required: 13,
            }
        } else {
            VAAStatus::Pending
        }
    }
}

impl Default for MockStorage {
    fn default() -> Self {
        Self::new()
    }
}

