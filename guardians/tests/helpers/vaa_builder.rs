use guardian_core::types::{Observation, Signature, VAA};
use guardian_core::signer::Signer;

pub struct VAABuilder {
    observation: Observation,
    signatures: Vec<Signature>,
    guardian_set_index: u32,
}

impl VAABuilder {
    pub fn new(observation: Observation) -> Self {
        Self {
            observation,
            signatures: Vec::new(),
            guardian_set_index: 0,
        }
    }
    
    pub fn with_guardian_set_index(mut self, index: u32) -> Self {
        self.guardian_set_index = index;
        self
    }
    
    pub fn add_signature(mut self, private_key: &str, guardian_index: u8) -> Self {
        let message_hash = self.observation.hash();
        let signer = Signer::new(private_key).unwrap();
        let mut signature = signer.sign(message_hash).unwrap();
        signature.guardian_index = guardian_index;
        self.signatures.push(signature);
        self
    }
    
    pub fn add_signatures_from_keys(mut self, keys: &[&str]) -> Self {
        let message_hash = self.observation.hash();
        
        for (i, key) in keys.iter().enumerate() {
            let signer = Signer::new(key).unwrap();
            let mut signature = signer.sign(message_hash).unwrap();
            signature.guardian_index = i as u8;
            self.signatures.push(signature);
        }
        
        self
    }
    
    pub fn build(self) -> VAA {
        VAA {
            version: 1,
            guardian_set_index: self.guardian_set_index,
            signatures: self.signatures,
            timestamp: self.observation.block_timestamp,
            nonce: self.observation.nonce,
            emitter_chain: self.observation.emitter_chain,
            emitter_address: self.observation.emitter_address,
            sequence: self.observation.sequence,
            consistency_level: self.observation.consistency_level,
            payload: self.observation.payload.clone(),
        }
    }
}

impl Default for VAABuilder {
    fn default() -> Self {
        let observation = Observation {
            tx_hash: [0xab; 32],
            block_number: 12345,
            block_timestamp: 1699276800,
            emitter_chain: 1,
            emitter_address: [0x74; 32],
            sequence: 42,
            nonce: 0,
            payload: vec![0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xe8],
            consistency_level: 200,
        };
        
        Self::new(observation)
    }
}

