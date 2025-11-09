pub mod handlers {
    use crate::storage::MockStorage;
    use crate::types::{VAA, VAAStatus};
    use axum::{
        extract::{Path, State},
        http::StatusCode,
        response::{IntoResponse, Json},
    };
    use serde::{Deserialize, Serialize};
    use std::sync::Arc;
    
    #[derive(Clone)]
    pub struct AppState {
        pub storage: MockStorage,
    }
    
    #[derive(Serialize)]
    pub struct VAAResponse {
        #[serde(rename = "vaaBytes")]
        pub vaa_bytes: String,
        pub vaa: VAAJson,
    }
    
    #[derive(Serialize)]
    pub struct VAAJson {
        pub version: u8,
        #[serde(rename = "guardianSetIndex")]
        pub guardian_set_index: u32,
        pub signatures: Vec<SignatureJson>,
        pub timestamp: u32,
        pub nonce: u32,
        #[serde(rename = "emitterChain")]
        pub emitter_chain: u16,
        #[serde(rename = "emitterAddress")]
        pub emitter_address: String,
        pub sequence: u64,
        #[serde(rename = "consistencyLevel")]
        pub consistency_level: u8,
        pub payload: String,
    }
    
    #[derive(Serialize)]
    pub struct SignatureJson {
        pub index: u8,
        pub signature: String,
    }
    
    #[derive(Serialize)]
    pub struct VAAStatusResponse {
        #[serde(rename = "messageId")]
        pub message_id: String,
        pub status: String,
        #[serde(rename = "signatureCount")]
        pub signature_count: usize,
        #[serde(rename = "requiredSignatures")]
        pub required_signatures: usize,
        pub progress: f64,
    }
    
    #[derive(Serialize)]
    pub struct AggregatingResponse {
        pub status: String,
        pub message: String,
        pub progress: ProgressInfo,
    }
    
    #[derive(Serialize)]
    pub struct ProgressInfo {
        pub current: usize,
        pub required: usize,
        pub percentage: f64,
    }
    
    #[derive(Serialize)]
    pub struct ErrorResponse {
        pub error: ErrorInfo,
    }
    
    #[derive(Serialize)]
    pub struct ErrorInfo {
        pub code: String,
        pub message: String,
    }
    
    impl From<VAA> for VAAJson {
        fn from(vaa: VAA) -> Self {
            Self {
                version: vaa.version,
                guardian_set_index: vaa.guardian_set_index,
                signatures: vaa.signatures.iter().map(|s| SignatureJson {
                    index: s.guardian_index,
                    signature: format!("0x{}", hex::encode(s.to_bytes())),
                }).collect(),
                timestamp: vaa.timestamp,
                nonce: vaa.nonce,
                emitter_chain: vaa.emitter_chain,
                emitter_address: format!("0x{}", hex::encode(vaa.emitter_address)),
                sequence: vaa.sequence,
                consistency_level: vaa.consistency_level,
                payload: format!("0x{}", hex::encode(&vaa.payload)),
            }
        }
    }
    
    pub async fn get_signed_vaa(
        State(state): State<Arc<AppState>>,
        Path((chain, emitter, sequence)): Path<(u16, String, u64)>,
    ) -> impl IntoResponse {
        let emitter_bytes = match hex::decode(emitter.trim_start_matches("0x")) {
            Ok(bytes) if bytes.len() == 20 => {
                let mut arr = [0u8; 32];
                arr[12..].copy_from_slice(&bytes);
                arr
            }
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: ErrorInfo {
                            code: "INVALID_ADDRESS".to_string(),
                            message: "Invalid emitter address format".to_string(),
                        },
                    }),
                ).into_response();
            }
        };
        
        let mut message_data = Vec::new();
        message_data.extend_from_slice(&0u32.to_be_bytes());
        message_data.extend_from_slice(&0u32.to_be_bytes());
        message_data.extend_from_slice(&chain.to_be_bytes());
        message_data.extend_from_slice(&emitter_bytes);
        message_data.extend_from_slice(&sequence.to_be_bytes());
        message_data.push(200);
        
        let message_hash = {
            use sha3::{Digest, Keccak256};
            let mut hasher = Keccak256::new();
            hasher.update(&message_data);
            hasher.finalize().into()
        };
        
        match state.storage.get_vaa(&message_hash).await {
            Some(vaa) => {
                let vaa_bytes = format!("0x{}", hex::encode(vaa.serialize()));
                (
                    StatusCode::OK,
                    Json(VAAResponse {
                        vaa_bytes,
                        vaa: vaa.into(),
                    }),
                ).into_response()
            }
            None => {
                let status = state.storage.get_vaa_status(&message_hash).await;
                match status {
                    VAAStatus::Aggregating { current, required } => {
                        (
                            StatusCode::ACCEPTED,
                            Json(AggregatingResponse {
                                status: "aggregating".to_string(),
                                message: "Waiting for more signatures".to_string(),
                                progress: ProgressInfo {
                                    current,
                                    required,
                                    percentage: current as f64 / required as f64,
                                },
                            }),
                        ).into_response()
                    }
                    _ => {
                        (
                            StatusCode::NOT_FOUND,
                            Json(ErrorResponse {
                                error: ErrorInfo {
                                    code: "VAA_NOT_FOUND".to_string(),
                                    message: format!(
                                        "No message found for chain={}, emitter=0x{}, sequence={}",
                                        chain, hex::encode(emitter_bytes), sequence
                                    ),
                                },
                            }),
                        ).into_response()
                    }
                }
            }
        }
    }
    
    pub async fn get_vaa_status(
        State(state): State<Arc<AppState>>,
        Path((chain, emitter, sequence)): Path<(u16, String, u64)>,
    ) -> impl IntoResponse {
        let message_id = format!("{}/0x{}/{}", chain, emitter, sequence);
        let sig_count = 0;
        
        (
            StatusCode::OK,
            Json(VAAStatusResponse {
                message_id,
                status: "pending".to_string(),
                signature_count: sig_count,
                required_signatures: 13,
                progress: sig_count as f64 / 13.0,
            }),
        )
    }
}

