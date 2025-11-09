use crate::types::{Observation, Signature, VAA};
use crate::storage::MockStorage;
use anyhow::Result;

pub struct Aggregator {
    storage: MockStorage,
    quorum: usize,
}

impl Aggregator {
    pub fn new(storage: MockStorage, quorum: usize) -> Self {
        Self { storage, quorum }
    }
    
    pub async fn add_signature(
        &self,
        message_hash: [u8; 32],
        signature: Signature,
    ) -> Result<Option<VAA>> {
        self.storage.store_signature(message_hash, signature).await?;
        
        let signature_count = self.storage.signature_count(&message_hash).await;
        
        if signature_count >= self.quorum {
            self.construct_vaa(message_hash).await
        } else {
            Ok(None)
        }
    }
    
    async fn construct_vaa(&self, message_hash: [u8; 32]) -> Result<Option<VAA>> {
        let observation = match self.storage.get_observation(&message_hash).await {
            Some(obs) => obs,
            None => return Ok(None),
        };
        
        let signatures = self.storage.get_signatures(&message_hash).await;
        
        let vaa = VAA {
            version: 1,
            guardian_set_index: 0,
            signatures,
            timestamp: observation.block_timestamp,
            nonce: observation.nonce,
            emitter_chain: observation.emitter_chain,
            emitter_address: observation.emitter_address,
            sequence: observation.sequence,
            consistency_level: observation.consistency_level,
            payload: observation.payload,
        };
        
        self.storage.store_vaa(vaa.clone()).await?;
        
        Ok(Some(vaa))
    }
}

