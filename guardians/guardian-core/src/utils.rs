use sha3::{Digest, Keccak256};

pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(data);
    hasher.finalize().into()
}

pub fn to_32_bytes(address: &[u8]) -> [u8; 32] {
    let mut result = [0u8; 32];
    let len = address.len().min(32);
    result[32 - len..].copy_from_slice(&address[..len]);
    result
}

pub fn from_32_bytes(bytes: &[u8; 32]) -> Vec<u8> {
    bytes.iter()
        .skip_while(|&&b| b == 0)
        .copied()
        .collect()
}

