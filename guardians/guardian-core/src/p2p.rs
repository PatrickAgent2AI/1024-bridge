use crate::types::{ObservationMessage, SignatureMessage, VAAReadyMessage};
use anyhow::Result;
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct MockP2P {
    observations: Arc<RwLock<VecDeque<ObservationMessage>>>,
    signatures: Arc<RwLock<VecDeque<SignatureMessage>>>,
    vaa_ready: Arc<RwLock<VecDeque<VAAReadyMessage>>>,
}

impl MockP2P {
    pub fn new() -> Self {
        Self {
            observations: Arc::new(RwLock::new(VecDeque::new())),
            signatures: Arc::new(RwLock::new(VecDeque::new())),
            vaa_ready: Arc::new(RwLock::new(VecDeque::new())),
        }
    }
    
    pub async fn publish_observation(&self, msg: ObservationMessage) -> Result<()> {
        self.observations.write().await.push_back(msg);
        Ok(())
    }
    
    pub async fn publish_signature(&self, msg: SignatureMessage) -> Result<()> {
        self.signatures.write().await.push_back(msg);
        Ok(())
    }
    
    pub async fn publish_vaa_ready(&self, msg: VAAReadyMessage) -> Result<()> {
        self.vaa_ready.write().await.push_back(msg);
        Ok(())
    }
    
    pub async fn receive_observation(&self) -> Option<ObservationMessage> {
        self.observations.write().await.pop_front()
    }
    
    pub async fn receive_signature(&self) -> Option<SignatureMessage> {
        self.signatures.write().await.pop_front()
    }
    
    pub async fn receive_vaa_ready(&self) -> Option<VAAReadyMessage> {
        self.vaa_ready.write().await.pop_front()
    }
    
    pub async fn observation_count(&self) -> usize {
        self.observations.read().await.len()
    }
    
    pub async fn signature_count(&self) -> usize {
        self.signatures.read().await.len()
    }
}

impl Default for MockP2P {
    fn default() -> Self {
        Self::new()
    }
}

