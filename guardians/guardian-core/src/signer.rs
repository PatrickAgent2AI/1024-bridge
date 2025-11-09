use crate::types::{Signature, GuardianSet};
use anyhow::{anyhow, Result};
use secp256k1::{Message, PublicKey, Secp256k1, SecretKey};
use sha3::{Digest, Keccak256};

pub struct Signer {
    secret_key: SecretKey,
    secp: Secp256k1<secp256k1::All>,
}

impl Signer {
    pub fn new(private_key_hex: &str) -> Result<Self> {
        let private_key_bytes = hex::decode(private_key_hex.trim_start_matches("0x"))?;
        let secret_key = SecretKey::from_slice(&private_key_bytes)?;
        let secp = Secp256k1::new();
        
        Ok(Self { secret_key, secp })
    }
    
    pub fn sign(&self, message_hash: [u8; 32]) -> Result<Signature> {
        let message = Message::from_digest_slice(&message_hash)?;
        let sig = self.secp.sign_ecdsa_recoverable(&message, &self.secret_key);
        
        let (recovery_id, compact_sig) = sig.serialize_compact();
        
        let mut r = [0u8; 32];
        let mut s = [0u8; 32];
        r.copy_from_slice(&compact_sig[0..32]);
        s.copy_from_slice(&compact_sig[32..64]);
        let v = 27 + recovery_id.to_i32() as u8;
        
        Ok(Signature {
            guardian_index: 0,
            r,
            s,
            v,
        })
    }
    
    pub fn get_address(&self) -> [u8; 20] {
        let public_key = PublicKey::from_secret_key(&self.secp, &self.secret_key);
        let public_key_bytes = public_key.serialize_uncompressed();
        
        let mut hasher = Keccak256::new();
        hasher.update(&public_key_bytes[1..]);
        let hash = hasher.finalize();
        
        let mut address = [0u8; 20];
        address.copy_from_slice(&hash[12..32]);
        address
    }
}

pub fn verify_guardian_signature(
    message_hash: [u8; 32],
    signature: &[u8; 65],
    guardian_index: u8,
    guardian_set: &GuardianSet,
) -> Result<()> {
    let guardian_key = guardian_set.keys
        .get(guardian_index as usize)
        .ok_or_else(|| anyhow!("Invalid guardian index"))?;
    
    let recovered_address = recover_signer(message_hash, signature)?;
    
    if recovered_address != *guardian_key {
        return Err(anyhow!("Signature verification failed"));
    }
    
    Ok(())
}

pub fn recover_signer(message_hash: [u8; 32], signature: &[u8; 65]) -> Result<[u8; 20]> {
    let secp = Secp256k1::new();
    
    let mut compact_sig = [0u8; 64];
    compact_sig.copy_from_slice(&signature[0..64]);
    let recovery_id = secp256k1::ecdsa::RecoveryId::from_i32((signature[64] - 27) as i32)?;
    
    let recoverable_sig = secp256k1::ecdsa::RecoverableSignature::from_compact(&compact_sig, recovery_id)?;
    let message = Message::from_digest_slice(&message_hash)?;
    let public_key = secp.recover_ecdsa(&message, &recoverable_sig)?;
    
    let public_key_bytes = public_key.serialize_uncompressed();
    let mut hasher = Keccak256::new();
    hasher.update(&public_key_bytes[1..]);
    let hash = hasher.finalize();
    
    let mut address = [0u8; 20];
    address.copy_from_slice(&hash[12..32]);
    
    Ok(address)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_signer_address_derivation() {
        let signer = Signer::new("0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d").unwrap();
        let address = signer.get_address();
        
        let expected = hex::decode("90F8bf6A479f320ead074411a4B0e7944Ea8c9C1").unwrap();
        let expected_array: [u8; 20] = expected.try_into().unwrap();
        
        assert_eq!(address, expected_array);
    }
}

