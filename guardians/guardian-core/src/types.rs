use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct VAA {
    pub version: u8,
    pub guardian_set_index: u32,
    pub signatures: Vec<Signature>,
    pub timestamp: u32,
    pub nonce: u32,
    pub emitter_chain: u16,
    pub emitter_address: [u8; 32],
    pub sequence: u64,
    pub consistency_level: u8,
    pub payload: Vec<u8>,
}

impl VAA {
    pub fn serialize(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        
        bytes.push(self.version);
        bytes.extend_from_slice(&self.guardian_set_index.to_be_bytes());
        bytes.push(self.signatures.len() as u8);
        
        for sig in &self.signatures {
            bytes.push(sig.guardian_index);
            bytes.extend_from_slice(&sig.r);
            bytes.extend_from_slice(&sig.s);
            bytes.push(sig.v);
        }
        
        bytes.extend_from_slice(&self.timestamp.to_be_bytes());
        bytes.extend_from_slice(&self.nonce.to_be_bytes());
        bytes.extend_from_slice(&self.emitter_chain.to_be_bytes());
        bytes.extend_from_slice(&self.emitter_address);
        bytes.extend_from_slice(&self.sequence.to_be_bytes());
        bytes.push(self.consistency_level);
        bytes.extend_from_slice(&self.payload);
        
        bytes
    }
    
    pub fn deserialize(bytes: &[u8]) -> anyhow::Result<Self> {
        let mut offset = 0;
        
        let version = bytes[offset];
        offset += 1;
        
        let guardian_set_index = u32::from_be_bytes([
            bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3]
        ]);
        offset += 4;
        
        let sig_count = bytes[offset] as usize;
        offset += 1;
        
        let mut signatures = Vec::new();
        for _ in 0..sig_count {
            let guardian_index = bytes[offset];
            offset += 1;
            
            let mut r = [0u8; 32];
            r.copy_from_slice(&bytes[offset..offset+32]);
            offset += 32;
            
            let mut s = [0u8; 32];
            s.copy_from_slice(&bytes[offset..offset+32]);
            offset += 32;
            
            let v = bytes[offset];
            offset += 1;
            
            signatures.push(Signature { guardian_index, r, s, v });
        }
        
        let timestamp = u32::from_be_bytes([
            bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3]
        ]);
        offset += 4;
        
        let nonce = u32::from_be_bytes([
            bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3]
        ]);
        offset += 4;
        
        let emitter_chain = u16::from_be_bytes([bytes[offset], bytes[offset+1]]);
        offset += 2;
        
        let mut emitter_address = [0u8; 32];
        emitter_address.copy_from_slice(&bytes[offset..offset+32]);
        offset += 32;
        
        let sequence = u64::from_be_bytes([
            bytes[offset], bytes[offset+1], bytes[offset+2], bytes[offset+3],
            bytes[offset+4], bytes[offset+5], bytes[offset+6], bytes[offset+7]
        ]);
        offset += 8;
        
        let consistency_level = bytes[offset];
        offset += 1;
        
        let payload = bytes[offset..].to_vec();
        
        Ok(VAA {
            version,
            guardian_set_index,
            signatures,
            timestamp,
            nonce,
            emitter_chain,
            emitter_address,
            sequence,
            consistency_level,
            payload,
        })
    }
    
    pub fn message_hash(&self) -> [u8; 32] {
        let mut data = Vec::new();
        data.extend_from_slice(&self.timestamp.to_be_bytes());
        data.extend_from_slice(&self.nonce.to_be_bytes());
        data.extend_from_slice(&self.emitter_chain.to_be_bytes());
        data.extend_from_slice(&self.emitter_address);
        data.extend_from_slice(&self.sequence.to_be_bytes());
        data.push(self.consistency_level);
        data.extend_from_slice(&self.payload);
        
        let mut hasher = Keccak256::new();
        hasher.update(&data);
        hasher.finalize().into()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct Signature {
    pub guardian_index: u8,
    pub r: [u8; 32],
    pub s: [u8; 32],
    pub v: u8,
}

impl Signature {
    pub fn to_bytes(&self) -> [u8; 65] {
        let mut bytes = [0u8; 65];
        bytes[0..32].copy_from_slice(&self.r);
        bytes[32..64].copy_from_slice(&self.s);
        bytes[64] = self.v;
        bytes
    }
    
    pub fn from_bytes(bytes: &[u8; 65]) -> Self {
        let mut r = [0u8; 32];
        let mut s = [0u8; 32];
        r.copy_from_slice(&bytes[0..32]);
        s.copy_from_slice(&bytes[32..64]);
        let v = bytes[64];
        
        Signature {
            guardian_index: 0,
            r,
            s,
            v,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Observation {
    pub tx_hash: [u8; 32],
    pub block_number: u64,
    pub block_timestamp: u32,
    pub emitter_chain: u16,
    pub emitter_address: [u8; 32],
    pub sequence: u64,
    pub nonce: u32,
    pub payload: Vec<u8>,
    pub consistency_level: u8,
}

impl Observation {
    pub fn hash(&self) -> [u8; 32] {
        let mut data = Vec::new();
        data.extend_from_slice(&self.block_timestamp.to_be_bytes());
        data.extend_from_slice(&self.nonce.to_be_bytes());
        data.extend_from_slice(&self.emitter_chain.to_be_bytes());
        data.extend_from_slice(&self.emitter_address);
        data.extend_from_slice(&self.sequence.to_be_bytes());
        data.push(self.consistency_level);
        data.extend_from_slice(&self.payload);
        
        let mut hasher = Keccak256::new();
        hasher.update(&data);
        hasher.finalize().into()
    }
    
    pub fn serialize(&self) -> Vec<u8> {
        bincode::serialize(self).unwrap()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GuardianSet {
    pub index: u32,
    pub keys: Vec<[u8; 20]>,
    pub creation_time: i64,
    pub expiration_time: u32,
}

impl GuardianSet {
    pub fn is_active(&self) -> bool {
        self.expiration_time == 0 || 
        self.expiration_time > chrono::Utc::now().timestamp() as u32
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChainConfig {
    pub chain_id: u16,
    pub chain_type: ChainType,
    pub name: String,
    pub rpc_url: String,
    pub core_address: String,
    pub confirmations: u64,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub enum ChainType {
    EVM,
    SVM,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ObservationMessage {
    pub message_hash: [u8; 32],
    pub emitter_chain: u16,
    pub emitter_address: [u8; 32],
    pub sequence: u64,
    pub timestamp: u32,
    pub nonce: u32,
    pub payload: Vec<u8>,
    pub consistency_level: u8,
    pub guardian_index: u8,
    pub signature: [u8; 65],
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SignatureMessage {
    pub message_hash: [u8; 32],
    pub guardian_index: u8,
    pub signature: [u8; 65],
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VAAReadyMessage {
    pub message_hash: [u8; 32],
    pub vaa: Vec<u8>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum VAAStatus {
    Pending,
    Aggregating { current: usize, required: usize },
    Ready,
    Consumed,
}

