mod helpers;

use guardian_core::types::{GuardianSet, VAA};
use guardian_core::storage::MockStorage;
use guardian_core::p2p::MockP2P;
use guardian_core::aggregator::Aggregator;
use guardian_core::types::{ObservationMessage, SignatureMessage};
use helpers::{
    create_test_guardian_set, create_test_observation_with_params,
    sign_observation, TEST_GUARDIAN_KEYS, MockChain, VAABuilder,
};
use std::sync::Arc;
use tokio::time::{timeout, sleep, Duration};
use serial_test::serial;

#[tokio::test]
#[serial]
async fn test_e2e_complete_vaa_generation_flow() {
    let storage = MockStorage::new();
    let p2p = MockP2P::new();
    let aggregator = Arc::new(Aggregator::new(storage.clone(), 13));
    let chain = MockChain::new(1);
    
    let emitter = [0x74; 32];
    let payload = vec![0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xe8];
    
    let tx_hash = chain.publish_message(emitter, 42, 0, payload.clone(), 200).await;
    
    chain.mine_blocks(64).await;
    
    let event = chain.get_event(0).await.unwrap();
    let observation = chain.to_observation(&event);
    let message_hash = observation.hash();
    
    storage.store_observation(observation.clone()).await.unwrap();
    
    let mut guardian_handles = vec![];
    for i in 0..19 {
        let observation_clone = observation.clone();
        let p2p_clone = p2p.clone();
        let aggregator_clone = aggregator.clone();
        
        let handle = tokio::spawn(async move {
            let signature = sign_observation(&observation_clone, TEST_GUARDIAN_KEYS[i as usize], i);
            
            let sig_message = SignatureMessage {
                message_hash: observation_clone.hash(),
                guardian_index: i,
                signature: signature.to_bytes(),
            };
            p2p_clone.publish_signature(sig_message).await.unwrap();
            
            aggregator_clone.add_signature(message_hash, signature).await.unwrap()
        });
        guardian_handles.push(handle);
    }
    
    let mut vaa_result = None;
    for handle in guardian_handles {
        if let Some(vaa) = handle.await.unwrap() {
            vaa_result = Some(vaa);
        }
    }
    
    assert!(vaa_result.is_some());
    let vaa = vaa_result.unwrap();
    
    assert_eq!(vaa.signatures.len(), 19);
    assert_eq!(vaa.emitter_chain, 1);
    assert_eq!(vaa.sequence, 42);
    assert_eq!(vaa.payload, payload);
    
    let stored_vaa = storage.get_vaa(&message_hash).await;
    assert!(stored_vaa.is_some());
    
    let serialized = vaa.serialize();
    let deserialized = VAA::deserialize(&serialized).unwrap();
    assert_eq!(vaa, deserialized);
}

#[tokio::test]
#[serial]
async fn test_e2e_complete_vaa_generation_flow_with_partial_guardians() {
    let storage = MockStorage::new();
    let aggregator = Arc::new(Aggregator::new(storage.clone(), 13));
    let chain = MockChain::new(1);
    
    let emitter = [0x74; 32];
    let payload = vec![0xaa, 0xbb, 0xcc];
    
    chain.publish_message(emitter, 1, 0, payload.clone(), 200).await;
    chain.mine_blocks(64).await;
    
    let event = chain.get_event(0).await.unwrap();
    let observation = chain.to_observation(&event);
    let message_hash = observation.hash();
    
    storage.store_observation(observation.clone()).await.unwrap();
    
    for i in 0..13 {
        let signature = sign_observation(&observation, TEST_GUARDIAN_KEYS[i as usize], i);
        aggregator.add_signature(message_hash, signature).await.unwrap();
    }
    
    let vaa = storage.get_vaa(&message_hash).await;
    assert!(vaa.is_some());
    assert_eq!(vaa.unwrap().signatures.len(), 13);
}

#[tokio::test]
#[serial]
async fn test_e2e_multi_chain_concurrent_listening() {
    let storage = MockStorage::new();
    let aggregator = Arc::new(Aggregator::new(storage.clone(), 13));
    
    let ethereum_chain = MockChain::new(1);
    let solana_chain = MockChain::new(2);
    let bsc_chain = MockChain::new(56);
    
    let emitter = [0x74; 32];
    
    ethereum_chain.publish_message(emitter, 1, 0, vec![0x01], 200).await;
    solana_chain.publish_message(emitter, 1, 0, vec![0x02], 200).await;
    bsc_chain.publish_message(emitter, 1, 0, vec![0x03], 200).await;
    
    ethereum_chain.mine_blocks(64).await;
    solana_chain.mine_blocks(32).await;
    bsc_chain.mine_blocks(15).await;
    
    let mut observations = vec![];
    
    let eth_event = ethereum_chain.get_event(0).await.unwrap();
    let eth_obs = ethereum_chain.to_observation(&eth_event);
    observations.push(eth_obs.clone());
    storage.store_observation(eth_obs.clone()).await.unwrap();
    
    let sol_event = solana_chain.get_event(0).await.unwrap();
    let sol_obs = solana_chain.to_observation(&sol_event);
    observations.push(sol_obs.clone());
    storage.store_observation(sol_obs.clone()).await.unwrap();
    
    let bsc_event = bsc_chain.get_event(0).await.unwrap();
    let bsc_obs = bsc_chain.to_observation(&bsc_event);
    observations.push(bsc_obs.clone());
    storage.store_observation(bsc_obs.clone()).await.unwrap();
    
    let mut handles = vec![];
    for obs in observations.iter() {
        let aggregator_clone = aggregator.clone();
        let obs_clone = obs.clone();
        
        let handle = tokio::spawn(async move {
            let message_hash = obs_clone.hash();
            for i in 0..13 {
                let signature = sign_observation(&obs_clone, TEST_GUARDIAN_KEYS[i as usize], i);
                aggregator_clone.add_signature(message_hash, signature).await.unwrap();
            }
            message_hash
        });
        handles.push(handle);
    }
    
    let mut message_hashes = vec![];
    for handle in handles {
        message_hashes.push(handle.await.unwrap());
    }
    
    for hash in message_hashes {
        let vaa = storage.get_vaa(&hash).await;
        assert!(vaa.is_some());
    }
    
    let eth_vaa = storage.get_vaa(&observations[0].hash()).await.unwrap();
    let sol_vaa = storage.get_vaa(&observations[1].hash()).await.unwrap();
    let bsc_vaa = storage.get_vaa(&observations[2].hash()).await.unwrap();
    
    assert_eq!(eth_vaa.emitter_chain, 1);
    assert_eq!(sol_vaa.emitter_chain, 2);
    assert_eq!(bsc_vaa.emitter_chain, 56);
    
    assert_eq!(eth_vaa.payload, vec![0x01]);
    assert_eq!(sol_vaa.payload, vec![0x02]);
    assert_eq!(bsc_vaa.payload, vec![0x03]);
}

#[tokio::test]
#[serial]
async fn test_e2e_guardian_set_upgrade() {
    let storage = MockStorage::new();
    
    let old_guardian_set = create_test_guardian_set();
    assert_eq!(old_guardian_set.index, 0);
    assert!(old_guardian_set.is_active());
    
    let chain = MockChain::new(1);
    let emitter = [0x74; 32];
    
    chain.publish_message(emitter, 1, 0, vec![0x01], 200).await;
    chain.mine_blocks(64).await;
    
    let event = chain.get_event(0).await.unwrap();
    let observation = chain.to_observation(&event);
    storage.store_observation(observation.clone()).await.unwrap();
    
    let vaa_with_old_set = VAABuilder::new(observation.clone())
        .with_guardian_set_index(0)
        .add_signatures_from_keys(&TEST_GUARDIAN_KEYS[0..13])
        .build();
    
    assert_eq!(vaa_with_old_set.guardian_set_index, 0);
    assert_eq!(vaa_with_old_set.signatures.len(), 13);
    
    let mut new_guardian_set = create_test_guardian_set();
    new_guardian_set.index = 1;
    new_guardian_set.expiration_time = 0;
    
    let mut old_guardian_set_expired = old_guardian_set.clone();
    old_guardian_set_expired.expiration_time = 
        (chrono::Utc::now().timestamp() + 7 * 86400) as u32;
    
    assert!(old_guardian_set_expired.is_active());
    assert!(new_guardian_set.is_active());
    
    chain.publish_message(emitter, 2, 0, vec![0x02], 200).await;
    chain.mine_blocks(64).await;
    
    let event2 = chain.get_event(1).await.unwrap();
    let observation2 = chain.to_observation(&event2);
    
    let vaa_with_new_set = VAABuilder::new(observation2.clone())
        .with_guardian_set_index(1)
        .add_signatures_from_keys(&TEST_GUARDIAN_KEYS[0..13])
        .build();
    
    assert_eq!(vaa_with_new_set.guardian_set_index, 1);
    
    old_guardian_set_expired.expiration_time = 
        (chrono::Utc::now().timestamp() - 1) as u32;
    assert!(!old_guardian_set_expired.is_active());
}

#[tokio::test]
#[serial]
async fn test_e2e_high_concurrency_vaa_generation() {
    let storage = MockStorage::new();
    let aggregator = Arc::new(Aggregator::new(storage.clone(), 13));
    let chain = MockChain::new(1);
    
    let emitter = [0x74; 32];
    let message_count = 100;
    
    for seq in 1..=message_count {
        let payload = vec![seq as u8];
        chain.publish_message(emitter, seq, 0, payload, 200).await;
    }
    
    chain.mine_blocks(64).await;
    
    let events = chain.get_events().await;
    assert_eq!(events.len(), message_count as usize);
    
    let mut observation_handles = vec![];
    
    for i in 0..message_count {
        let storage_clone = storage.clone();
        let chain_clone = chain.clone();
        
        let handle = tokio::spawn(async move {
            let event = chain_clone.get_event(i as usize).await.unwrap();
            let observation = chain_clone.to_observation(&event);
            storage_clone.store_observation(observation.clone()).await.unwrap();
            observation
        });
        observation_handles.push(handle);
    }
    
    let mut observations = vec![];
    for handle in observation_handles {
        observations.push(handle.await.unwrap());
    }
    
    let mut signing_handles = vec![];
    
    for obs in observations.iter() {
        let aggregator_clone = aggregator.clone();
        let obs_clone = obs.clone();
        
        let handle = tokio::spawn(async move {
            let message_hash = obs_clone.hash();
            for i in 0..13 {
                let signature = sign_observation(&obs_clone, TEST_GUARDIAN_KEYS[i as usize], i);
                aggregator_clone.add_signature(message_hash, signature).await.unwrap();
            }
        });
        signing_handles.push(handle);
    }
    
    for handle in signing_handles {
        handle.await.unwrap();
    }
    
    for obs in observations.iter() {
        let vaa = storage.get_vaa(&obs.hash()).await;
        assert!(vaa.is_some(), "VAA not found for sequence {}", obs.sequence);
    }
}

#[tokio::test]
#[serial]
async fn test_e2e_chain_reorganization_handling() {
    let storage = MockStorage::new();
    let aggregator = Aggregator::new(storage.clone(), 13);
    let chain = MockChain::new(1);
    
    let emitter = [0x74; 32];
    
    chain.publish_message(emitter, 1, 0, vec![0x01], 200).await;
    
    let initial_block = chain.get_current_block().await;
    
    chain.mine_blocks(10).await;
    
    let event_before_reorg = chain.get_event(0).await.unwrap();
    let obs_before_reorg = chain.to_observation(&event_before_reorg);
    
    for i in 0..5 {
        let signature = sign_observation(&obs_before_reorg, TEST_GUARDIAN_KEYS[i as usize], i);
        aggregator.add_signature(obs_before_reorg.hash(), signature).await.unwrap();
    }
    
    let sig_count_before = storage.signature_count(&obs_before_reorg.hash()).await;
    assert_eq!(sig_count_before, 5);
    
    let new_block = initial_block;
    *chain.current_block.write().await = new_block;
    
    chain.publish_message(emitter, 1, 0, vec![0x01], 200).await;
    chain.mine_blocks(64).await;
    
    let event_after_reorg = chain.get_event(1).await.unwrap();
    let obs_after_reorg = chain.to_observation(&event_after_reorg);
    
    storage.store_observation(obs_after_reorg.clone()).await.unwrap();
    
    for i in 0..13 {
        let signature = sign_observation(&obs_after_reorg, TEST_GUARDIAN_KEYS[i as usize], i);
        aggregator.add_signature(obs_after_reorg.hash(), signature).await.unwrap();
    }
    
    let vaa = storage.get_vaa(&obs_after_reorg.hash()).await;
    assert!(vaa.is_some());
}

#[tokio::test]
#[serial]
async fn test_e2e_node_crash_and_recovery() {
    let storage = MockStorage::new();
    let aggregator = Arc::new(Aggregator::new(storage.clone(), 13));
    let chain = MockChain::new(1);
    
    let emitter = [0x74; 32];
    
    chain.publish_message(emitter, 1, 0, vec![0x01], 200).await;
    chain.mine_blocks(64).await;
    
    let event = chain.get_event(0).await.unwrap();
    let observation = chain.to_observation(&event);
    let message_hash = observation.hash();
    
    storage.store_observation(observation.clone()).await.unwrap();
    
    for i in 0..8 {
        let signature = sign_observation(&observation, TEST_GUARDIAN_KEYS[i as usize], i);
        aggregator.add_signature(message_hash, signature).await.unwrap();
    }
    
    let sig_count = storage.signature_count(&message_hash).await;
    assert_eq!(sig_count, 8);
    
    let recovered_observation = storage.get_observation(&message_hash).await;
    assert!(recovered_observation.is_some());
    
    for i in 8..13 {
        let signature = sign_observation(&observation, TEST_GUARDIAN_KEYS[i as usize], i);
        aggregator.add_signature(message_hash, signature).await.unwrap();
    }
    
    let vaa = storage.get_vaa(&message_hash).await;
    assert!(vaa.is_some());
    
    let final_vaa = vaa.unwrap();
    assert_eq!(final_vaa.signatures.len(), 13);
}

#[tokio::test]
#[serial]
async fn test_e2e_database_connection_failure_recovery() {
    let storage = MockStorage::new();
    let aggregator = Aggregator::new(storage.clone(), 13);
    
    let observation = create_test_observation_with_params(1, 1, vec![0xaa]);
    let message_hash = observation.hash();
    
    storage.store_observation(observation.clone()).await.unwrap();
    
    for i in 0..5 {
        let signature = sign_observation(&observation, TEST_GUARDIAN_KEYS[i as usize], i);
        aggregator.add_signature(message_hash, signature).await.unwrap();
    }
    
    let stored_obs = storage.get_observation(&message_hash).await;
    assert!(stored_obs.is_some());
    
    let sig_count = storage.signature_count(&message_hash).await;
    assert_eq!(sig_count, 5);
    
    for i in 5..13 {
        let signature = sign_observation(&observation, TEST_GUARDIAN_KEYS[i as usize], i);
        aggregator.add_signature(message_hash, signature).await.unwrap();
    }
    
    let vaa = storage.get_vaa(&message_hash).await;
    assert!(vaa.is_some());
}

#[tokio::test]
#[serial]
async fn test_e2e_signature_aggregation_with_delayed_guardians() {
    let storage = MockStorage::new();
    let aggregator = Arc::new(Aggregator::new(storage.clone(), 13));
    let observation = create_test_observation_with_params(1, 42, vec![0xcc]);
    let message_hash = observation.hash();
    
    storage.store_observation(observation.clone()).await.unwrap();
    
    let mut fast_handles = vec![];
    for i in 0..13 {
        let aggregator_clone = aggregator.clone();
        let obs_clone = observation.clone();
        
        let handle = tokio::spawn(async move {
            let signature = sign_observation(&obs_clone, TEST_GUARDIAN_KEYS[i as usize], i);
            aggregator_clone.add_signature(message_hash, signature).await.unwrap()
        });
        fast_handles.push(handle);
    }
    
    for handle in fast_handles {
        handle.await.unwrap();
    }
    
    let vaa = storage.get_vaa(&message_hash).await;
    assert!(vaa.is_some());
    assert_eq!(vaa.unwrap().signatures.len(), 13);
    
    sleep(Duration::from_millis(100)).await;
    
    let mut delayed_handles = vec![];
    for i in 13..19 {
        let aggregator_clone = aggregator.clone();
        let obs_clone = observation.clone();
        
        let handle = tokio::spawn(async move {
            let signature = sign_observation(&obs_clone, TEST_GUARDIAN_KEYS[i as usize], i);
            aggregator_clone.add_signature(message_hash, signature).await.unwrap()
        });
        delayed_handles.push(handle);
    }
    
    for handle in delayed_handles {
        handle.await.unwrap();
    }
    
    let final_sig_count = storage.signature_count(&message_hash).await;
    assert_eq!(final_sig_count, 19);
}

