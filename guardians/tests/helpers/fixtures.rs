use guardian_core::types::{GuardianSet, Observation, Signature, VAA};
use guardian_core::signer::Signer;
use sha3::{Digest, Keccak256};

pub const TEST_GUARDIAN_KEYS: [&str; 19] = [
    "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d",
    "0x6cbed15c793ce57650b9877cf6fa156fbef513c4e6134f022a85b1ffdd59b2a1",
    "0x6370fd033278c143179d81c5526140625662b8daa446c22ee2d73db3707e620c",
    "0x646f1ce2fdad0e6deeeb5c7e8e5543bdde65e86029e2fd9fc169899c440a7913",
    "0xadd53f9a7e588d003326d1cbf9e4a43c061aadd9bc938c843a79e7b4fd2ad743",
    "0x395df67f0c2d2d9fe1ad08d1bc8b6627011959b79c53d7dd6a3536a33ab8a4fd",
    "0xe485d098507f54e7733a205420dfddbe58db035fa577fc294ebd14db90767a52",
    "0xa453611d9419d0e56f499079478fd72c37b251a94bfde4d19872c44cf65386e3",
    "0x829e924fdf021ba3dbbc4225edfece9aca04b929d6e75613329ca6f1d31c0bb4",
    "0xb0057716d5917badaf911b193b12b910811c1497b5bada8d7711f758981c3773",
    "0x77c5495fbb039eed474fc940f29955ed0531693cc9212911efd35dff0373153f",
    "0xd99b5b29e6da2528bf458b26237a6cf8655a3e3276c1cdc0de1f98cefee81c01",
    "0x9b9c613a36396172eab2d34d72331c8ca83a358781883a535d2941f66db07b24",
    "0x0874049f95d55fb76916262dc70571701b5c4cc5900c0691af75f1a8a52c8268",
    "0x21d7212f3b4e5332fd465877b64926e3532653e2798a11255a46f533852dfe46",
    "0x47b65e1d4c0b09bb8bd88c6b23af8c47c8c3f3d3e1a5dc0c8a2ec8d9a1e1cf1a",
    "0x3c45b8a3d9b4c7e6f1a2d5c8b7e9f0a3c6d9e2f5a8b1c4d7e0f3a6b9c2d5e8f1",
    "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
    "0x9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d",
];

pub fn create_test_guardian_set() -> GuardianSet {
    let mut keys = Vec::new();
    
    for key_hex in TEST_GUARDIAN_KEYS.iter() {
        let signer = Signer::new(key_hex).unwrap();
        let address = signer.get_address();
        keys.push(address);
    }
    
    GuardianSet {
        index: 0,
        keys,
        creation_time: chrono::Utc::now().timestamp(),
        expiration_time: 0,
    }
}

pub fn create_test_observation() -> Observation {
    Observation {
        tx_hash: [0xab; 32],
        block_number: 12345,
        block_timestamp: 1699276800,
        emitter_chain: 1,
        emitter_address: [0x74; 32],
        sequence: 42,
        nonce: 0,
        payload: vec![0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xe8],
        consistency_level: 200,
    }
}

pub fn create_test_observation_with_params(
    chain: u16,
    sequence: u64,
    payload: Vec<u8>,
) -> Observation {
    Observation {
        tx_hash: [0xab; 32],
        block_number: 12345,
        block_timestamp: 1699276800,
        emitter_chain: chain,
        emitter_address: [0x74; 32],
        sequence,
        nonce: 0,
        payload,
        consistency_level: 200,
    }
}

pub fn create_test_vaa() -> VAA {
    let mut signatures = Vec::new();
    
    for i in 0..13 {
        signatures.push(Signature {
            guardian_index: i,
            r: [i as u8; 32],
            s: [i as u8; 32],
            v: 27,
        });
    }
    
    VAA {
        version: 1,
        guardian_set_index: 0,
        signatures,
        timestamp: 1699276800,
        nonce: 0,
        emitter_chain: 1,
        emitter_address: [0x74; 32],
        sequence: 42,
        consistency_level: 200,
        payload: vec![0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xe8],
    }
}

pub fn create_test_vaa_with_real_signatures(observation: &Observation, guardian_keys: &[&str]) -> VAA {
    let message_hash = observation.hash();
    let mut signatures = Vec::new();
    
    for (i, key) in guardian_keys.iter().enumerate().take(13) {
        let signer = Signer::new(key).unwrap();
        let mut sig = signer.sign(message_hash).unwrap();
        sig.guardian_index = i as u8;
        signatures.push(sig);
    }
    
    VAA {
        version: 1,
        guardian_set_index: 0,
        signatures,
        timestamp: observation.block_timestamp,
        nonce: observation.nonce,
        emitter_chain: observation.emitter_chain,
        emitter_address: observation.emitter_address,
        sequence: observation.sequence,
        consistency_level: observation.consistency_level,
        payload: observation.payload.clone(),
    }
}

pub fn sign_observation(observation: &Observation, private_key: &str, guardian_index: u8) -> Signature {
    let message_hash = observation.hash();
    let signer = Signer::new(private_key).unwrap();
    let mut signature = signer.sign(message_hash).unwrap();
    signature.guardian_index = guardian_index;
    signature
}

pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(data);
    hasher.finalize().into()
}

