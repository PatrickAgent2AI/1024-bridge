mod helpers;

use guardian_core::types::{ChainType, Observation, Signature, VAA};
use guardian_core::config::{GuardianConfig, create_test_chain_config};
use guardian_core::signer::{Signer, verify_guardian_signature, recover_signer};
use guardian_core::storage::MockStorage;
use guardian_core::utils::{keccak256, to_32_bytes, from_32_bytes};
use helpers::{
    create_test_guardian_set, create_test_observation, create_test_vaa,
    create_test_vaa_with_real_signatures, TEST_GUARDIAN_KEYS,
};

#[test]
fn test_vaa_serialization() {
    let vaa = create_test_vaa();
    let bytes = vaa.serialize();
    let deserialized = VAA::deserialize(&bytes).unwrap();
    assert_eq!(vaa, deserialized);
}

#[test]
fn test_vaa_deserialization_with_minimal_vaa() {
    let vaa = VAA {
        version: 1,
        guardian_set_index: 0,
        signatures: vec![],
        timestamp: 1699276800,
        nonce: 0,
        emitter_chain: 1,
        emitter_address: [0; 32],
        sequence: 1,
        consistency_level: 200,
        payload: vec![],
    };
    
    let bytes = vaa.serialize();
    let deserialized = VAA::deserialize(&bytes).unwrap();
    
    assert_eq!(deserialized.version, 1);
    assert_eq!(deserialized.signatures.len(), 0);
    assert_eq!(deserialized.payload.len(), 0);
}

#[test]
fn test_vaa_serialization_with_multiple_signatures() {
    let mut vaa = create_test_vaa();
    for i in 13..19 {
        vaa.signatures.push(Signature {
            guardian_index: i,
            r: [i as u8; 32],
            s: [i as u8; 32],
            v: 27,
        });
    }
    
    let bytes = vaa.serialize();
    let deserialized = VAA::deserialize(&bytes).unwrap();
    
    assert_eq!(vaa.signatures.len(), deserialized.signatures.len());
    assert_eq!(vaa, deserialized);
}

#[test]
fn test_vaa_message_hash_deterministic() {
    let vaa1 = create_test_vaa();
    let vaa2 = create_test_vaa();
    
    assert_eq!(vaa1.message_hash(), vaa2.message_hash());
}

#[test]
fn test_vaa_message_hash_changes_with_payload() {
    let mut vaa1 = create_test_vaa();
    let mut vaa2 = create_test_vaa();
    vaa2.payload = vec![0x02, 0x00, 0x00, 0x00];
    
    assert_ne!(vaa1.message_hash(), vaa2.message_hash());
}

#[test]
fn test_vaa_serialization_byte_layout() {
    let vaa = VAA {
        version: 1,
        guardian_set_index: 5,
        signatures: vec![],
        timestamp: 1699276800,
        nonce: 123,
        emitter_chain: 2,
        emitter_address: [0xaa; 32],
        sequence: 999,
        consistency_level: 200,
        payload: vec![0x01, 0x02, 0x03],
    };
    
    let bytes = vaa.serialize();
    
    assert_eq!(bytes[0], 1);
    assert_eq!(u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]), 5);
    assert_eq!(bytes[5], 0);
}

#[test]
fn test_vaa_serialization_with_large_payload() {
    let mut vaa = create_test_vaa();
    vaa.payload = vec![0xff; 10000];
    
    let bytes = vaa.serialize();
    let deserialized = VAA::deserialize(&bytes).unwrap();
    
    assert_eq!(deserialized.payload.len(), 10000);
    assert_eq!(vaa, deserialized);
}

#[test]
fn test_vaa_deserialization_invalid_data() {
    let invalid_bytes = vec![0xff; 10];
    let result = VAA::deserialize(&invalid_bytes);
    assert!(result.is_err());
}

#[test]
fn test_signature_generation() {
    let private_key = TEST_GUARDIAN_KEYS[0];
    let signer = Signer::new(private_key).unwrap();
    let message_hash = keccak256(b"test message");
    let signature = signer.sign(message_hash).unwrap();
    
    assert_eq!(signature.to_bytes().len(), 65);
}

#[test]
fn test_signature_deterministic() {
    let private_key = TEST_GUARDIAN_KEYS[0];
    let signer = Signer::new(private_key).unwrap();
    let message_hash = keccak256(b"test message");
    
    let sig1 = signer.sign(message_hash).unwrap();
    let sig2 = signer.sign(message_hash).unwrap();
    
    assert_eq!(sig1.r, sig2.r);
    assert_eq!(sig1.s, sig2.s);
    assert_eq!(sig1.v, sig2.v);
}

#[test]
fn test_signature_recovery() {
    let private_key = TEST_GUARDIAN_KEYS[0];
    let signer = Signer::new(private_key).unwrap();
    let expected_address = signer.get_address();
    
    let message_hash = keccak256(b"test message");
    let signature = signer.sign(message_hash).unwrap();
    
    let recovered_address = recover_signer(message_hash, &signature.to_bytes()).unwrap();
    assert_eq!(recovered_address, expected_address);
}

#[test]
fn test_signature_verification_valid() {
    let guardian_set = create_test_guardian_set();
    let private_key = TEST_GUARDIAN_KEYS[0];
    let signer = Signer::new(private_key).unwrap();
    
    let message_hash = keccak256(b"test message");
    let signature = signer.sign(message_hash).unwrap();
    
    let result = verify_guardian_signature(
        message_hash,
        &signature.to_bytes(),
        0,
        &guardian_set,
    );
    
    assert!(result.is_ok());
}

#[test]
fn test_signature_verification_invalid_index() {
    let guardian_set = create_test_guardian_set();
    let private_key = TEST_GUARDIAN_KEYS[0];
    let signer = Signer::new(private_key).unwrap();
    
    let message_hash = keccak256(b"test message");
    let signature = signer.sign(message_hash).unwrap();
    
    let result = verify_guardian_signature(
        message_hash,
        &signature.to_bytes(),
        99,
        &guardian_set,
    );
    
    assert!(result.is_err());
}

#[test]
fn test_signature_verification_wrong_signer() {
    let guardian_set = create_test_guardian_set();
    let private_key = TEST_GUARDIAN_KEYS[0];
    let signer = Signer::new(private_key).unwrap();
    
    let message_hash = keccak256(b"test message");
    let signature = signer.sign(message_hash).unwrap();
    
    let result = verify_guardian_signature(
        message_hash,
        &signature.to_bytes(),
        1,
        &guardian_set,
    );
    
    assert!(result.is_err());
}

#[test]
fn test_config_default_test_config() {
    let config = GuardianConfig::default_test_config();
    
    assert_eq!(config.index, 0);
    assert_eq!(config.api.port, 7071);
    assert_eq!(config.p2p.listen_address, "/ip4/127.0.0.1/tcp/8999");
}

#[test]
fn test_config_chain_config_ethereum() {
    let config = create_test_chain_config(1, ChainType::EVM);
    
    assert_eq!(config.chain_id, 1);
    assert_eq!(config.chain_type, ChainType::EVM);
    assert_eq!(config.name, "Ethereum");
    assert_eq!(config.confirmations, 64);
}

#[test]
fn test_config_chain_config_solana() {
    let config = create_test_chain_config(2, ChainType::SVM);
    
    assert_eq!(config.chain_id, 2);
    assert_eq!(config.chain_type, ChainType::SVM);
    assert_eq!(config.name, "Solana");
    assert_eq!(config.confirmations, 32);
}

#[test]
fn test_config_chain_config_enabled_by_default() {
    let config = create_test_chain_config(1, ChainType::EVM);
    assert!(config.enabled);
}

#[test]
fn test_config_admin_config() {
    let config = GuardianConfig::default_test_config();
    
    assert_eq!(config.admin.secret, "test-secret");
    assert!(config.admin.allowed_ips.contains(&"127.0.0.1".to_string()));
}

#[tokio::test]
async fn test_storage_store_and_retrieve_observation() {
    let storage = MockStorage::new();
    let observation = create_test_observation();
    let hash = observation.hash();
    
    storage.store_observation(observation.clone()).await.unwrap();
    let retrieved = storage.get_observation(&hash).await;
    
    assert_eq!(retrieved, Some(observation));
}

#[tokio::test]
async fn test_storage_store_and_retrieve_signature() {
    let storage = MockStorage::new();
    let observation = create_test_observation();
    let message_hash = observation.hash();
    
    let signature = Signature {
        guardian_index: 0,
        r: [1; 32],
        s: [2; 32],
        v: 27,
    };
    
    storage.store_signature(message_hash, signature.clone()).await.unwrap();
    let signatures = storage.get_signatures(&message_hash).await;
    
    assert_eq!(signatures.len(), 1);
    assert_eq!(signatures[0], signature);
}

#[tokio::test]
async fn test_storage_multiple_signatures() {
    let storage = MockStorage::new();
    let message_hash = [0xaa; 32];
    
    for i in 0..5 {
        let signature = Signature {
            guardian_index: i,
            r: [i as u8; 32],
            s: [i as u8; 32],
            v: 27,
        };
        storage.store_signature(message_hash, signature).await.unwrap();
    }
    
    let signatures = storage.get_signatures(&message_hash).await;
    assert_eq!(signatures.len(), 5);
}

#[tokio::test]
async fn test_storage_signature_count() {
    let storage = MockStorage::new();
    let message_hash = [0xbb; 32];
    
    assert_eq!(storage.signature_count(&message_hash).await, 0);
    
    for i in 0..13 {
        let signature = Signature {
            guardian_index: i,
            r: [i as u8; 32],
            s: [i as u8; 32],
            v: 27,
        };
        storage.store_signature(message_hash, signature).await.unwrap();
    }
    
    assert_eq!(storage.signature_count(&message_hash).await, 13);
}

#[tokio::test]
async fn test_storage_store_and_retrieve_vaa() {
    let storage = MockStorage::new();
    let vaa = create_test_vaa();
    let hash = vaa.message_hash();
    
    storage.store_vaa(vaa.clone()).await.unwrap();
    let retrieved = storage.get_vaa(&hash).await;
    
    assert_eq!(retrieved, Some(vaa));
}

#[tokio::test]
async fn test_storage_vaa_status_pending() {
    let storage = MockStorage::new();
    let message_hash = [0xcc; 32];
    
    let status = storage.get_vaa_status(&message_hash).await;
    
    match status {
        guardian_core::types::VAAStatus::Pending => {},
        _ => panic!("Expected Pending status"),
    }
}

#[tokio::test]
async fn test_storage_vaa_status_aggregating() {
    let storage = MockStorage::new();
    let observation = create_test_observation();
    let message_hash = observation.hash();
    
    storage.store_observation(observation).await.unwrap();
    
    for i in 0..5 {
        let signature = Signature {
            guardian_index: i,
            r: [i as u8; 32],
            s: [i as u8; 32],
            v: 27,
        };
        storage.store_signature(message_hash, signature).await.unwrap();
    }
    
    let status = storage.get_vaa_status(&message_hash).await;
    
    match status {
        guardian_core::types::VAAStatus::Aggregating { current, required } => {
            assert_eq!(current, 5);
            assert_eq!(required, 13);
        },
        _ => panic!("Expected Aggregating status"),
    }
}

#[tokio::test]
async fn test_storage_vaa_status_ready() {
    let storage = MockStorage::new();
    let vaa = create_test_vaa();
    let hash = vaa.message_hash();
    
    storage.store_vaa(vaa).await.unwrap();
    let status = storage.get_vaa_status(&hash).await;
    
    match status {
        guardian_core::types::VAAStatus::Ready => {},
        _ => panic!("Expected Ready status"),
    }
}

#[tokio::test]
async fn test_storage_observation_not_found() {
    let storage = MockStorage::new();
    let hash = [0xdd; 32];
    
    let result = storage.get_observation(&hash).await;
    assert_eq!(result, None);
}

#[tokio::test]
async fn test_storage_concurrent_writes() {
    let storage = MockStorage::new();
    let message_hash = [0xee; 32];
    
    let mut handles = vec![];
    
    for i in 0..10 {
        let storage_clone = storage.clone();
        let handle = tokio::spawn(async move {
            let signature = Signature {
                guardian_index: i,
                r: [i as u8; 32],
                s: [i as u8; 32],
                v: 27,
            };
            storage_clone.store_signature(message_hash, signature).await.unwrap();
        });
        handles.push(handle);
    }
    
    for handle in handles {
        handle.await.unwrap();
    }
    
    let count = storage.signature_count(&message_hash).await;
    assert_eq!(count, 10);
}

#[test]
fn test_address_conversion_to_32_bytes() {
    let address: Vec<u8> = vec![0x12, 0x34, 0x56, 0x78, 0x9a];
    let result = to_32_bytes(&address);
    
    assert_eq!(result[27], 0x12);
    assert_eq!(result[31], 0x9a);
}

#[test]
fn test_address_conversion_from_32_bytes() {
    let mut bytes = [0u8; 32];
    bytes[27] = 0x12;
    bytes[31] = 0x9a;
    
    let result = from_32_bytes(&bytes);
    assert_eq!(result, vec![0x12, 0x00, 0x00, 0x00, 0x9a]);
}

#[test]
fn test_address_conversion_ethereum_address() {
    let eth_address = hex::decode("742d35Cc6634C0532925a3b844Bc9e7595f0bEb").unwrap();
    let result = to_32_bytes(&eth_address);
    
    assert_eq!(result[12..32], eth_address[..]);
}

#[test]
fn test_address_conversion_full_32_bytes() {
    let full_address = [0xff; 32];
    let result = to_32_bytes(&full_address);
    assert_eq!(result, full_address);
}

#[test]
fn test_address_conversion_empty() {
    let empty: Vec<u8> = vec![];
    let result = to_32_bytes(&empty);
    assert_eq!(result, [0u8; 32]);
}

#[test]
fn test_address_conversion_roundtrip() {
    let original = vec![0x11, 0x22, 0x33, 0x44, 0x55];
    let bytes_32 = to_32_bytes(&original);
    let result = from_32_bytes(&bytes_32);
    
    let trimmed_original = original.iter()
        .skip_while(|&&b| b == 0)
        .copied()
        .collect::<Vec<u8>>();
    let trimmed_result = result.iter()
        .skip_while(|&&b| b == 0)
        .copied()
        .collect::<Vec<u8>>();
    
    assert_eq!(trimmed_result, trimmed_original);
}

#[test]
fn test_observation_hash_deterministic() {
    let obs1 = create_test_observation();
    let obs2 = create_test_observation();
    
    assert_eq!(obs1.hash(), obs2.hash());
}

#[test]
fn test_observation_hash_different_payload() {
    let mut obs1 = create_test_observation();
    let mut obs2 = create_test_observation();
    obs2.payload = vec![0xff];
    
    assert_ne!(obs1.hash(), obs2.hash());
}

#[test]
fn test_observation_serialization() {
    let observation = create_test_observation();
    let bytes = observation.serialize();
    
    assert!(!bytes.is_empty());
}

#[test]
fn test_observation_different_chain() {
    let mut obs1 = create_test_observation();
    let mut obs2 = create_test_observation();
    obs2.emitter_chain = 2;
    
    assert_ne!(obs1.hash(), obs2.hash());
}

#[test]
fn test_observation_different_sequence() {
    let mut obs1 = create_test_observation();
    let mut obs2 = create_test_observation();
    obs2.sequence = 999;
    
    assert_ne!(obs1.hash(), obs2.hash());
}

#[test]
fn test_signature_to_bytes() {
    let signature = Signature {
        guardian_index: 5,
        r: [0x11; 32],
        s: [0x22; 32],
        v: 27,
    };
    
    let bytes = signature.to_bytes();
    
    assert_eq!(bytes.len(), 65);
    assert_eq!(bytes[0], 0x11);
    assert_eq!(bytes[32], 0x22);
    assert_eq!(bytes[64], 27);
}

#[test]
fn test_signature_from_bytes() {
    let mut bytes = [0u8; 65];
    bytes[0..32].fill(0x11);
    bytes[32..64].fill(0x22);
    bytes[64] = 27;
    
    let signature = Signature::from_bytes(&bytes);
    
    assert_eq!(signature.r, [0x11; 32]);
    assert_eq!(signature.s, [0x22; 32]);
    assert_eq!(signature.v, 27);
}

#[test]
fn test_guardian_set_is_active_no_expiration() {
    let guardian_set = create_test_guardian_set();
    assert!(guardian_set.is_active());
}

#[test]
fn test_guardian_set_is_active_future_expiration() {
    let mut guardian_set = create_test_guardian_set();
    guardian_set.expiration_time = (chrono::Utc::now().timestamp() + 86400) as u32;
    assert!(guardian_set.is_active());
}

#[test]
fn test_guardian_set_is_not_active_past_expiration() {
    let mut guardian_set = create_test_guardian_set();
    guardian_set.expiration_time = (chrono::Utc::now().timestamp() - 86400) as u32;
    assert!(!guardian_set.is_active());
}

#[test]
fn test_guardian_set_keys_count() {
    let guardian_set = create_test_guardian_set();
    assert_eq!(guardian_set.keys.len(), 19);
}

#[test]
fn test_keccak256_empty() {
    let hash = keccak256(&[]);
    assert_eq!(hash.len(), 32);
    assert_ne!(hash, [0u8; 32]);
}

#[test]
fn test_keccak256_deterministic() {
    let data = b"test data";
    let hash1 = keccak256(data);
    let hash2 = keccak256(data);
    assert_eq!(hash1, hash2);
}

#[test]
fn test_keccak256_different_inputs() {
    let hash1 = keccak256(b"data1");
    let hash2 = keccak256(b"data2");
    assert_ne!(hash1, hash2);
}

