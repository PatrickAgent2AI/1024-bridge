mod helpers;

use axum::{
    Router,
    routing::get,
};
use guardian_core::api::handlers::{AppState, get_signed_vaa, get_vaa_status};
use guardian_core::storage::MockStorage;
use guardian_core::p2p::MockP2P;
use guardian_core::aggregator::Aggregator;
use guardian_core::types::{ObservationMessage, SignatureMessage, VAAReadyMessage};
use helpers::{
    create_test_observation, create_test_vaa, create_test_vaa_with_real_signatures,
    create_test_guardian_set, sign_observation, TEST_GUARDIAN_KEYS, MockChain,
};
use std::sync::Arc;
use tokio::time::{timeout, Duration};

fn create_test_app(storage: MockStorage) -> Router {
    let state = Arc::new(AppState { storage });
    
    Router::new()
        .route("/v1/signed_vaa/:chain/:emitter/:sequence", get(get_signed_vaa))
        .route("/v1/vaa/status/:chain/:emitter/:sequence", get(get_vaa_status))
        .with_state(state)
}

#[tokio::test]
async fn test_api_get_signed_vaa_ready() {
    let storage = MockStorage::new();
    let vaa = create_test_vaa();
    let hash = vaa.message_hash();
    
    storage.store_vaa(vaa.clone()).await.unwrap();
    
    let app = create_test_app(storage);
    let emitter_hex = hex::encode(vaa.emitter_address);
    
    let response = axum_test::TestServer::new(app)
        .unwrap()
        .get(&format!("/v1/signed_vaa/1/{}/42", emitter_hex))
        .await;
    
    response.assert_status_ok();
}

#[tokio::test]
async fn test_api_get_signed_vaa_aggregating() {
    let storage = MockStorage::new();
    let observation = create_test_observation();
    let message_hash = observation.hash();
    
    storage.store_observation(observation.clone()).await.unwrap();
    
    for i in 0..5 {
        let signature = sign_observation(&observation, TEST_GUARDIAN_KEYS[i as usize], i);
        storage.store_signature(message_hash, signature).await.unwrap();
    }
    
    let app = create_test_app(storage);
    let emitter_hex = hex::encode(observation.emitter_address);
    
    let response = axum_test::TestServer::new(app)
        .unwrap()
        .get(&format!("/v1/signed_vaa/1/{}/{}", emitter_hex, observation.sequence))
        .await;
    
    response.assert_status(axum::http::StatusCode::ACCEPTED);
}

#[tokio::test]
async fn test_api_get_signed_vaa_not_found() {
    let storage = MockStorage::new();
    let app = create_test_app(storage);
    
    let response = axum_test::TestServer::new(app)
        .unwrap()
        .get("/v1/signed_vaa/1/742d35Cc6634C0532925a3b844Bc9e7595f0bEb/999")
        .await;
    
    response.assert_status(axum::http::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_api_get_signed_vaa_invalid_chain() {
    let storage = MockStorage::new();
    let app = create_test_app(storage);
    
    let response = axum_test::TestServer::new(app)
        .unwrap()
        .get("/v1/signed_vaa/0/742d35Cc6634C0532925a3b844Bc9e7595f0bEb/42")
        .await;
    
    response.assert_status_client_error();
}

#[tokio::test]
async fn test_api_get_signed_vaa_invalid_address() {
    let storage = MockStorage::new();
    let app = create_test_app(storage);
    
    let response = axum_test::TestServer::new(app)
        .unwrap()
        .get("/v1/signed_vaa/1/invalid_address/42")
        .await;
    
    response.assert_status(axum::http::StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_api_get_vaa_status() {
    let storage = MockStorage::new();
    let app = create_test_app(storage);
    
    let response = axum_test::TestServer::new(app)
        .unwrap()
        .get("/v1/vaa/status/1/742d35Cc6634C0532925a3b844Bc9e7595f0bEb/42")
        .await;
    
    response.assert_status_ok();
}

#[tokio::test]
async fn test_api_multiple_concurrent_requests() {
    let storage = MockStorage::new();
    let vaa = create_test_vaa();
    storage.store_vaa(vaa.clone()).await.unwrap();
    
    let app = create_test_app(storage);
    let server = Arc::new(axum_test::TestServer::new(app).unwrap());
    
    let mut handles = vec![];
    
    for _ in 0..10 {
        let server_clone = server.clone();
        let emitter_hex = hex::encode(vaa.emitter_address);
        
        let handle = tokio::spawn(async move {
            let response = server_clone
                .get(&format!("/v1/signed_vaa/1/{}/42", emitter_hex))
                .await;
            response.assert_status_ok();
        });
        
        handles.push(handle);
    }
    
    for handle in handles {
        handle.await.unwrap();
    }
}

#[tokio::test]
async fn test_api_vaa_bytes_format() {
    let storage = MockStorage::new();
    let vaa = create_test_vaa();
    storage.store_vaa(vaa.clone()).await.unwrap();
    
    let app = create_test_app(storage);
    let emitter_hex = hex::encode(vaa.emitter_address);
    
    let response = axum_test::TestServer::new(app)
        .unwrap()
        .get(&format!("/v1/signed_vaa/1/{}/42", emitter_hex))
        .await;
    
    let body = response.json::<serde_json::Value>();
    assert!(body["vaaBytes"].as_str().unwrap().starts_with("0x"));
}

#[tokio::test]
async fn test_api_vaa_json_structure() {
    let storage = MockStorage::new();
    let vaa = create_test_vaa();
    storage.store_vaa(vaa.clone()).await.unwrap();
    
    let app = create_test_app(storage);
    let emitter_hex = hex::encode(vaa.emitter_address);
    
    let response = axum_test::TestServer::new(app)
        .unwrap()
        .get(&format!("/v1/signed_vaa/1/{}/42", emitter_hex))
        .await;
    
    let body = response.json::<serde_json::Value>();
    
    assert!(body["vaa"]["version"].is_number());
    assert!(body["vaa"]["signatures"].is_array());
    assert!(body["vaa"]["timestamp"].is_number());
}

#[tokio::test]
async fn test_api_signature_count_in_vaa() {
    let storage = MockStorage::new();
    let vaa = create_test_vaa();
    storage.store_vaa(vaa.clone()).await.unwrap();
    
    let app = create_test_app(storage);
    let emitter_hex = hex::encode(vaa.emitter_address);
    
    let response = axum_test::TestServer::new(app)
        .unwrap()
        .get(&format!("/v1/signed_vaa/1/{}/42", emitter_hex))
        .await;
    
    let body = response.json::<serde_json::Value>();
    let sig_count = body["vaa"]["signatures"].as_array().unwrap().len();
    
    assert!(sig_count >= 13);
}

#[tokio::test]
async fn test_api_progress_info() {
    let storage = MockStorage::new();
    let observation = create_test_observation();
    let message_hash = observation.hash();
    
    storage.store_observation(observation.clone()).await.unwrap();
    
    for i in 0..8 {
        let signature = sign_observation(&observation, TEST_GUARDIAN_KEYS[i as usize], i);
        storage.store_signature(message_hash, signature).await.unwrap();
    }
    
    let app = create_test_app(storage);
    let emitter_hex = hex::encode(observation.emitter_address);
    
    let response = axum_test::TestServer::new(app)
        .unwrap()
        .get(&format!("/v1/signed_vaa/1/{}/{}", emitter_hex, observation.sequence))
        .await;
    
    let body = response.json::<serde_json::Value>();
    
    assert_eq!(body["progress"]["current"], 8);
    assert_eq!(body["progress"]["required"], 13);
}

#[tokio::test]
async fn test_api_error_format() {
    let storage = MockStorage::new();
    let app = create_test_app(storage);
    
    let response = axum_test::TestServer::new(app)
        .unwrap()
        .get("/v1/signed_vaa/1/invalid_address/42")
        .await;
    
    let body = response.json::<serde_json::Value>();
    
    assert!(body["error"]["code"].is_string());
    assert!(body["error"]["message"].is_string());
}

#[tokio::test]
async fn test_watcher_observe_event() {
    let chain = MockChain::new(1);
    let emitter = [0x74; 32];
    let payload = vec![0x01, 0x02, 0x03];
    
    let tx_hash = chain.publish_message(emitter, 1, 0, payload.clone(), 200).await;
    
    let events = chain.get_events().await;
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].sequence, 1);
    assert_eq!(events[0].payload, payload);
}

#[tokio::test]
async fn test_watcher_wait_confirmations() {
    let chain = MockChain::new(1);
    let emitter = [0x74; 32];
    
    chain.publish_message(emitter, 1, 0, vec![0x01], 200).await;
    let start_block = chain.get_current_block().await;
    
    assert!(!chain.wait_for_confirmations(start_block, 64).await);
    
    chain.mine_blocks(64).await;
    
    assert!(chain.wait_for_confirmations(start_block, 64).await);
}

#[tokio::test]
async fn test_watcher_multiple_events() {
    let chain = MockChain::new(1);
    let emitter = [0x74; 32];
    
    for i in 1..=10 {
        chain.publish_message(emitter, i, 0, vec![i as u8], 200).await;
        chain.mine_blocks(1).await;
    }
    
    let events = chain.get_events().await;
    assert_eq!(events.len(), 10);
}

#[tokio::test]
async fn test_watcher_observation_conversion() {
    let chain = MockChain::new(1);
    let emitter = [0x74; 32];
    let payload = vec![0xaa, 0xbb, 0xcc];
    
    chain.publish_message(emitter, 1, 123, payload.clone(), 200).await;
    
    let event = chain.get_event(0).await.unwrap();
    let observation = chain.to_observation(&event);
    
    assert_eq!(observation.emitter_chain, 1);
    assert_eq!(observation.emitter_address, emitter);
    assert_eq!(observation.sequence, 1);
    assert_eq!(observation.nonce, 123);
    assert_eq!(observation.payload, payload);
}

#[tokio::test]
async fn test_watcher_block_number_tracking() {
    let chain = MockChain::new(1);
    
    assert_eq!(chain.get_current_block().await, 1);
    
    chain.mine_blocks(10).await;
    assert_eq!(chain.get_current_block().await, 11);
    
    chain.mine_blocks(5).await;
    assert_eq!(chain.get_current_block().await, 16);
}

#[tokio::test]
async fn test_watcher_concurrent_events() {
    let chain = MockChain::new(1);
    let emitter = [0x74; 32];
    
    let mut handles = vec![];
    
    for i in 1..=20 {
        let chain_clone = chain.clone();
        let handle = tokio::spawn(async move {
            chain_clone.publish_message(emitter, i, 0, vec![i as u8], 200).await;
        });
        handles.push(handle);
    }
    
    for handle in handles {
        handle.await.unwrap();
    }
    
    let events = chain.get_events().await;
    assert_eq!(events.len(), 20);
}

#[tokio::test]
async fn test_watcher_different_chains() {
    let chain1 = MockChain::new(1);
    let chain2 = MockChain::new(2);
    
    chain1.publish_message([0x11; 32], 1, 0, vec![0x01], 200).await;
    chain2.publish_message([0x22; 32], 1, 0, vec![0x02], 200).await;
    
    let event1 = chain1.get_event(0).await.unwrap();
    let event2 = chain2.get_event(0).await.unwrap();
    
    let obs1 = chain1.to_observation(&event1);
    let obs2 = chain2.to_observation(&event2);
    
    assert_eq!(obs1.emitter_chain, 1);
    assert_eq!(obs2.emitter_chain, 2);
}

#[tokio::test]
async fn test_watcher_consistency_levels() {
    let chain = MockChain::new(1);
    let emitter = [0x74; 32];
    
    chain.publish_message(emitter, 1, 0, vec![0x01], 1).await;
    chain.publish_message(emitter, 2, 0, vec![0x02], 15).await;
    chain.publish_message(emitter, 3, 0, vec![0x03], 200).await;
    
    let events = chain.get_events().await;
    
    assert_eq!(events[0].consistency_level, 1);
    assert_eq!(events[1].consistency_level, 15);
    assert_eq!(events[2].consistency_level, 200);
}

#[tokio::test]
async fn test_p2p_publish_observation() {
    let p2p = MockP2P::new();
    let observation = create_test_observation();
    let signature = sign_observation(&observation, TEST_GUARDIAN_KEYS[0], 0);
    
    let message = ObservationMessage {
        message_hash: observation.hash(),
        emitter_chain: observation.emitter_chain,
        emitter_address: observation.emitter_address,
        sequence: observation.sequence,
        timestamp: observation.block_timestamp,
        nonce: observation.nonce,
        payload: observation.payload.clone(),
        consistency_level: observation.consistency_level,
        guardian_index: 0,
        signature: signature.to_bytes(),
    };
    
    p2p.publish_observation(message.clone()).await.unwrap();
    
    let received = p2p.receive_observation().await;
    assert!(received.is_some());
    assert_eq!(received.unwrap().sequence, observation.sequence);
}

#[tokio::test]
async fn test_p2p_publish_signature() {
    let p2p = MockP2P::new();
    let message_hash = [0xaa; 32];
    let signature = sign_observation(&create_test_observation(), TEST_GUARDIAN_KEYS[0], 0);
    
    let message = SignatureMessage {
        message_hash,
        guardian_index: 0,
        signature: signature.to_bytes(),
    };
    
    p2p.publish_signature(message.clone()).await.unwrap();
    
    let received = p2p.receive_signature().await;
    assert!(received.is_some());
    assert_eq!(received.unwrap().guardian_index, 0);
}

#[tokio::test]
async fn test_p2p_publish_vaa_ready() {
    let p2p = MockP2P::new();
    let vaa = create_test_vaa();
    
    let message = VAAReadyMessage {
        message_hash: vaa.message_hash(),
        vaa: vaa.serialize(),
    };
    
    p2p.publish_vaa_ready(message.clone()).await.unwrap();
    
    let received = p2p.receive_vaa_ready().await;
    assert!(received.is_some());
}

#[tokio::test]
async fn test_p2p_message_ordering() {
    let p2p = MockP2P::new();
    
    for i in 0..5 {
        let observation = create_test_observation();
        let signature = sign_observation(&observation, TEST_GUARDIAN_KEYS[i], i as u8);
        
        let message = ObservationMessage {
            message_hash: observation.hash(),
            emitter_chain: observation.emitter_chain,
            emitter_address: observation.emitter_address,
            sequence: i as u64,
            timestamp: observation.block_timestamp,
            nonce: observation.nonce,
            payload: observation.payload.clone(),
            consistency_level: observation.consistency_level,
            guardian_index: i as u8,
            signature: signature.to_bytes(),
        };
        
        p2p.publish_observation(message).await.unwrap();
    }
    
    for i in 0..5 {
        let received = p2p.receive_observation().await;
        assert!(received.is_some());
        assert_eq!(received.unwrap().sequence, i as u64);
    }
}

#[tokio::test]
async fn test_p2p_concurrent_publishing() {
    let p2p = MockP2P::new();
    let mut handles = vec![];
    
    for i in 0..10 {
        let p2p_clone = p2p.clone();
        let handle = tokio::spawn(async move {
            let message_hash = [i as u8; 32];
            let signature = [0; 65];
            
            let message = SignatureMessage {
                message_hash,
                guardian_index: i as u8,
                signature,
            };
            
            p2p_clone.publish_signature(message).await.unwrap();
        });
        handles.push(handle);
    }
    
    for handle in handles {
        handle.await.unwrap();
    }
    
    let count = p2p.signature_count().await;
    assert_eq!(count, 10);
}

#[tokio::test]
async fn test_p2p_empty_queues() {
    let p2p = MockP2P::new();
    
    assert_eq!(p2p.observation_count().await, 0);
    assert_eq!(p2p.signature_count().await, 0);
    
    assert!(p2p.receive_observation().await.is_none());
    assert!(p2p.receive_signature().await.is_none());
    assert!(p2p.receive_vaa_ready().await.is_none());
}

#[tokio::test]
async fn test_signature_aggregation_threshold() {
    let storage = MockStorage::new();
    let aggregator = Aggregator::new(storage.clone(), 13);
    let observation = create_test_observation();
    let message_hash = observation.hash();
    
    storage.store_observation(observation.clone()).await.unwrap();
    
    for i in 0..12 {
        let signature = sign_observation(&observation, TEST_GUARDIAN_KEYS[i as usize], i);
        let result = aggregator.add_signature(message_hash, signature).await.unwrap();
        assert!(result.is_none());
    }
    
    let signature = sign_observation(&observation, TEST_GUARDIAN_KEYS[12], 12);
    let result = aggregator.add_signature(message_hash, signature).await.unwrap();
    assert!(result.is_some());
}

#[tokio::test]
async fn test_signature_aggregation_vaa_construction() {
    let storage = MockStorage::new();
    let aggregator = Aggregator::new(storage.clone(), 13);
    let observation = create_test_observation();
    let message_hash = observation.hash();
    
    storage.store_observation(observation.clone()).await.unwrap();
    
    for i in 0..13 {
        let signature = sign_observation(&observation, TEST_GUARDIAN_KEYS[i as usize], i);
        aggregator.add_signature(message_hash, signature).await.unwrap();
    }
    
    let vaa = storage.get_vaa(&message_hash).await;
    assert!(vaa.is_some());
    
    let vaa = vaa.unwrap();
    assert_eq!(vaa.signatures.len(), 13);
    assert_eq!(vaa.emitter_chain, observation.emitter_chain);
    assert_eq!(vaa.sequence, observation.sequence);
}

#[tokio::test]
async fn test_signature_aggregation_concurrent() {
    let storage = MockStorage::new();
    let aggregator = Arc::new(Aggregator::new(storage.clone(), 13));
    let observation = create_test_observation();
    let message_hash = observation.hash();
    
    storage.store_observation(observation.clone()).await.unwrap();
    
    let mut handles = vec![];
    
    for i in 0..15 {
        let aggregator_clone = aggregator.clone();
        let obs_clone = observation.clone();
        let handle = tokio::spawn(async move {
            let signature = sign_observation(&obs_clone, TEST_GUARDIAN_KEYS[i as usize], i);
            aggregator_clone.add_signature(message_hash, signature).await
        });
        handles.push(handle);
    }
    
    let mut vaa_found = false;
    for handle in handles {
        if let Ok(Some(_)) = handle.await.unwrap() {
            vaa_found = true;
        }
    }
    
    assert!(vaa_found);
}

#[tokio::test]
async fn test_signature_verification_valid_set() {
    let guardian_set = create_test_guardian_set();
    let observation = create_test_observation();
    let message_hash = observation.hash();
    
    for i in 0..13 {
        let signature = sign_observation(&observation, TEST_GUARDIAN_KEYS[i as usize], i);
        let result = guardian_core::signer::verify_guardian_signature(
            message_hash,
            &signature.to_bytes(),
            i,
            &guardian_set,
        );
        assert!(result.is_ok());
    }
}

#[tokio::test]
async fn test_signature_verification_invalid_guardian_index() {
    let guardian_set = create_test_guardian_set();
    let observation = create_test_observation();
    let message_hash = observation.hash();
    
    let signature = sign_observation(&observation, TEST_GUARDIAN_KEYS[0], 0);
    let result = guardian_core::signer::verify_guardian_signature(
        message_hash,
        &signature.to_bytes(),
        1,
        &guardian_set,
    );
    assert!(result.is_err());
}

#[tokio::test]
async fn test_signature_verification_wrong_message() {
    let guardian_set = create_test_guardian_set();
    let observation1 = create_test_observation();
    let mut observation2 = observation1.clone();
    observation2.sequence = 999;
    
    let signature = sign_observation(&observation1, TEST_GUARDIAN_KEYS[0], 0);
    let result = guardian_core::signer::verify_guardian_signature(
        observation2.hash(),
        &signature.to_bytes(),
        0,
        &guardian_set,
    );
    assert!(result.is_err());
}

