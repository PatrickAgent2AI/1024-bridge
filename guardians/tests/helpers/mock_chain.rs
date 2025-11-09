use guardian_core::types::Observation;
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct MockChain {
    events: Arc<RwLock<VecDeque<ChainEvent>>>,
    current_block: Arc<RwLock<u64>>,
    chain_id: u16,
}

#[derive(Clone, Debug)]
pub struct ChainEvent {
    pub block_number: u64,
    pub tx_hash: [u8; 32],
    pub emitter: [u8; 32],
    pub sequence: u64,
    pub nonce: u32,
    pub payload: Vec<u8>,
    pub consistency_level: u8,
}

impl MockChain {
    pub fn new(chain_id: u16) -> Self {
        Self {
            events: Arc::new(RwLock::new(VecDeque::new())),
            current_block: Arc::new(RwLock::new(1)),
            chain_id,
        }
    }
    
    pub async fn publish_message(
        &self,
        emitter: [u8; 32],
        sequence: u64,
        nonce: u32,
        payload: Vec<u8>,
        consistency_level: u8,
    ) -> [u8; 32] {
        let block_number = *self.current_block.read().await;
        
        let mut tx_hash = [0u8; 32];
        tx_hash[0..8].copy_from_slice(&sequence.to_be_bytes());
        tx_hash[8..12].copy_from_slice(&nonce.to_be_bytes());
        
        let event = ChainEvent {
            block_number,
            tx_hash,
            emitter,
            sequence,
            nonce,
            payload,
            consistency_level,
        };
        
        self.events.write().await.push_back(event);
        
        tx_hash
    }
    
    pub async fn mine_blocks(&self, count: u64) {
        let mut current = self.current_block.write().await;
        *current += count;
    }
    
    pub async fn get_current_block(&self) -> u64 {
        *self.current_block.read().await
    }
    
    pub async fn get_events(&self) -> Vec<ChainEvent> {
        self.events.read().await.iter().cloned().collect()
    }
    
    pub async fn get_event(&self, index: usize) -> Option<ChainEvent> {
        self.events.read().await.get(index).cloned()
    }
    
    pub fn to_observation(&self, event: &ChainEvent) -> Observation {
        Observation {
            tx_hash: event.tx_hash,
            block_number: event.block_number,
            block_timestamp: (chrono::Utc::now().timestamp() as u32),
            emitter_chain: self.chain_id,
            emitter_address: event.emitter,
            sequence: event.sequence,
            nonce: event.nonce,
            payload: event.payload.clone(),
            consistency_level: event.consistency_level,
        }
    }
    
    pub async fn wait_for_confirmations(&self, start_block: u64, confirmations: u64) -> bool {
        let current = self.get_current_block().await;
        current >= start_block + confirmations
    }
}

