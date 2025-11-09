use crate::types::{ChainConfig, ChainType};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GuardianConfig {
    pub index: u8,
    pub private_key: String,
    pub api: ApiConfig,
    pub p2p: P2PConfig,
    pub database: DatabaseConfig,
    pub monitoring: MonitoringConfig,
    pub admin: AdminConfig,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ApiConfig {
    pub host: String,
    pub port: u16,
    pub rate_limit: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct P2PConfig {
    pub listen_address: String,
    pub bootstrap_peers: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DatabaseConfig {
    pub postgres_url: String,
    pub redis_url: String,
    pub max_connections: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MonitoringConfig {
    pub prometheus_port: u16,
    pub log_level: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AdminConfig {
    pub secret: String,
    pub allowed_ips: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ConfigFile {
    guardian: GuardianConfig,
    #[serde(default)]
    chains: HashMap<String, HashMap<String, ChainConfig>>,
}

impl GuardianConfig {
    pub fn load_from_file(path: &str) -> Result<(Self, Vec<ChainConfig>)> {
        let content = fs::read_to_string(path)?;
        let config: ConfigFile = toml::from_str(&content)?;
        
        let mut chains = Vec::new();
        if let Some(evm_chains) = config.chains.get("evm") {
            chains.extend(evm_chains.values().cloned());
        }
        if let Some(svm_chains) = config.chains.get("svm") {
            chains.extend(svm_chains.values().cloned());
        }
        
        Ok((config.guardian, chains))
    }
    
    pub fn default_test_config() -> Self {
        Self {
            index: 0,
            private_key: "0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d".to_string(),
            api: ApiConfig {
                host: "127.0.0.1".to_string(),
                port: 7071,
                rate_limit: 100,
            },
            p2p: P2PConfig {
                listen_address: "/ip4/127.0.0.1/tcp/8999".to_string(),
                bootstrap_peers: vec![],
            },
            database: DatabaseConfig {
                postgres_url: "postgresql://test:test@localhost/test".to_string(),
                redis_url: "redis://localhost:6379".to_string(),
                max_connections: 10,
            },
            monitoring: MonitoringConfig {
                prometheus_port: 9090,
                log_level: "info".to_string(),
            },
            admin: AdminConfig {
                secret: "test-secret".to_string(),
                allowed_ips: vec!["127.0.0.1".to_string()],
            },
        }
    }
}

pub fn create_test_chain_config(chain_id: u16, chain_type: ChainType) -> ChainConfig {
    let (name, rpc_url, core_address, confirmations) = match (chain_id, chain_type) {
        (1, ChainType::EVM) => (
            "Ethereum".to_string(),
            "http://localhost:8545".to_string(),
            "0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B".to_string(),
            64,
        ),
        (2, ChainType::SVM) => (
            "Solana".to_string(),
            "http://localhost:8899".to_string(),
            "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth".to_string(),
            32,
        ),
        _ => (
            format!("TestChain{}", chain_id),
            "http://localhost:8545".to_string(),
            "0x0000000000000000000000000000000000000000".to_string(),
            10,
        ),
    };
    
    ChainConfig {
        chain_id,
        chain_type,
        name,
        rpc_url,
        core_address,
        confirmations,
        enabled: true,
    }
}

