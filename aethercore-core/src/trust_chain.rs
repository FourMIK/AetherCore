//! Trust chain implementation for 4MIK.
//!
//! Provides a verifiable chain of trust linking identities, messages, and actions.
//! Each link in the chain is cryptographically signed and can be independently verified.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A link in the trust chain representing a verifiable action or event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TrustLink {
    /// Unique identifier for this link
    pub id: String,
    /// Previous link hash (empty for genesis link)
    pub previous_hash: Vec<u8>,
    /// Hash of this link's content
    pub hash: Vec<u8>,
    /// Identity that created this link
    pub identity_id: String,
    /// Signature over the hash
    pub signature: Vec<u8>,
    /// Timestamp of link creation
    pub timestamp: u64,
    /// Type of action or event
    pub action_type: String,
    /// Serialized payload
    pub payload: Vec<u8>,
}

/// Trust chain maintaining a verifiable sequence of links.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustChain {
    /// Chain identifier
    pub chain_id: String,
    /// All links in the chain, indexed by hash
    links: HashMap<Vec<u8>, TrustLink>,
    /// Head of the chain (most recent link)
    head: Option<Vec<u8>>,
    /// Genesis link hash
    genesis: Option<Vec<u8>>,
}

impl TrustChain {
    /// Create a new empty trust chain.
    pub fn new(chain_id: impl Into<String>) -> Self {
        Self {
            chain_id: chain_id.into(),
            links: HashMap::new(),
            head: None,
            genesis: None,
        }
    }

    /// Add a genesis link to start the chain.
    pub fn add_genesis(&mut self, link: TrustLink) -> crate::Result<()> {
        if self.genesis.is_some() {
            return Err(crate::Error::Config(
                "Chain already has genesis link".to_string(),
            ));
        }
        if !link.previous_hash.is_empty() {
            return Err(crate::Error::Config(
                "Genesis link must have empty previous_hash".to_string(),
            ));
        }

        let hash = link.hash.clone();
        self.links.insert(hash.clone(), link);
        self.genesis = Some(hash.clone());
        self.head = Some(hash);
        Ok(())
    }

    /// Add a new link to the chain.
    pub fn add_link(&mut self, link: TrustLink) -> crate::Result<()> {
        // Verify the link connects to the current head
        if let Some(head_hash) = &self.head {
            if &link.previous_hash != head_hash {
                return Err(crate::Error::Config(
                    "Link does not connect to chain head".to_string(),
                ));
            }
        } else {
            return Err(crate::Error::Config(
                "Chain must have genesis link first".to_string(),
            ));
        }

        // Verify link is not already in chain
        if self.links.contains_key(&link.hash) {
            return Err(crate::Error::Config(
                "Link already exists in chain".to_string(),
            ));
        }

        let hash = link.hash.clone();
        self.links.insert(hash.clone(), link);
        self.head = Some(hash);
        Ok(())
    }

    /// Get the current head of the chain.
    pub fn get_head(&self) -> Option<&TrustLink> {
        self.head.as_ref().and_then(|h| self.links.get(h))
    }

    /// Get a specific link by hash.
    pub fn get_link(&self, hash: &[u8]) -> Option<&TrustLink> {
        self.links.get(hash)
    }

    /// Verify the integrity of the entire chain.
    pub fn verify_chain(&self) -> crate::Result<bool> {
        let Some(genesis_hash) = &self.genesis else {
            return Err(crate::Error::Config("Chain has no genesis".to_string()));
        };

        let mut current_hash = genesis_hash.clone();
        let mut visited = 0;

        loop {
            let _link = self
                .links
                .get(&current_hash)
                .ok_or_else(|| crate::Error::Config("Missing link in chain".to_string()))?;

            visited += 1;

            // If this is the head, we're done
            if Some(&current_hash) == self.head.as_ref() {
                break;
            }

            // Find the next link that points to this one
            let next = self
                .links
                .values()
                .find(|l| l.previous_hash == current_hash);

            match next {
                Some(next_link) => current_hash = next_link.hash.clone(),
                None => return Err(crate::Error::Config("Chain is broken".to_string())),
            }

            // Prevent infinite loops
            if visited > self.links.len() {
                return Err(crate::Error::Config("Chain has cycles".to_string()));
            }
        }

        Ok(true)
    }

    /// Get the length of the chain.
    pub fn len(&self) -> usize {
        self.links.len()
    }

    /// Check if the chain is empty.
    pub fn is_empty(&self) -> bool {
        self.links.is_empty()
    }

    /// Iterate through the chain from genesis to head.
    pub fn iter_forward(&self) -> impl Iterator<Item = &TrustLink> {
        let mut result = Vec::new();
        if let Some(genesis_hash) = &self.genesis {
            let mut current_hash = genesis_hash.clone();
            while let Some(link) = self.links.get(&current_hash) {
                result.push(link);
                // Find next link
                let next = self
                    .links
                    .values()
                    .find(|l| l.previous_hash == current_hash);
                match next {
                    Some(next_link) => current_hash = next_link.hash.clone(),
                    None => break,
                }
            }
        }
        result.into_iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_link(id: &str, prev_hash: Vec<u8>, hash: Vec<u8>) -> TrustLink {
        TrustLink {
            id: id.to_string(),
            previous_hash: prev_hash,
            hash,
            identity_id: "test-identity".to_string(),
            signature: vec![1, 2, 3],
            timestamp: 1000,
            action_type: "test".to_string(),
            payload: vec![],
        }
    }

    #[test]
    fn test_new_chain() {
        let chain = TrustChain::new("test-chain");
        assert_eq!(chain.chain_id, "test-chain");
        assert!(chain.is_empty());
        assert!(chain.get_head().is_none());
    }

    #[test]
    fn test_add_genesis() {
        let mut chain = TrustChain::new("test-chain");
        let genesis = create_link("genesis", vec![], vec![1, 2, 3]);

        chain.add_genesis(genesis.clone()).unwrap();

        assert_eq!(chain.len(), 1);
        assert_eq!(chain.get_head().unwrap().id, "genesis");
    }

    #[test]
    fn test_add_links() {
        let mut chain = TrustChain::new("test-chain");
        let genesis = create_link("genesis", vec![], vec![1, 2, 3]);
        chain.add_genesis(genesis.clone()).unwrap();

        let link2 = create_link("link2", vec![1, 2, 3], vec![4, 5, 6]);
        chain.add_link(link2).unwrap();

        let link3 = create_link("link3", vec![4, 5, 6], vec![7, 8, 9]);
        chain.add_link(link3).unwrap();

        assert_eq!(chain.len(), 3);
        assert_eq!(chain.get_head().unwrap().id, "link3");
    }

    #[test]
    fn test_verify_chain() {
        let mut chain = TrustChain::new("test-chain");
        let genesis = create_link("genesis", vec![], vec![1, 2, 3]);
        chain.add_genesis(genesis).unwrap();

        let link2 = create_link("link2", vec![1, 2, 3], vec![4, 5, 6]);
        chain.add_link(link2).unwrap();

        assert!(chain.verify_chain().unwrap());
    }

    #[test]
    fn test_iter_forward() {
        let mut chain = TrustChain::new("test-chain");
        let genesis = create_link("genesis", vec![], vec![1, 2, 3]);
        chain.add_genesis(genesis).unwrap();

        let link2 = create_link("link2", vec![1, 2, 3], vec![4, 5, 6]);
        chain.add_link(link2).unwrap();

        let ids: Vec<_> = chain.iter_forward().map(|l| l.id.as_str()).collect();
        assert_eq!(ids, vec!["genesis", "link2"]);
    }

    #[test]
    fn test_reject_duplicate_genesis() {
        let mut chain = TrustChain::new("test-chain");
        let genesis = create_link("genesis", vec![], vec![1, 2, 3]);
        chain.add_genesis(genesis.clone()).unwrap();

        let result = chain.add_genesis(genesis);
        assert!(result.is_err());
    }

    #[test]
    fn test_reject_non_connecting_link() {
        let mut chain = TrustChain::new("test-chain");
        let genesis = create_link("genesis", vec![], vec![1, 2, 3]);
        chain.add_genesis(genesis).unwrap();

        let bad_link = create_link("bad", vec![9, 9, 9], vec![4, 5, 6]);
        let result = chain.add_link(bad_link);
        assert!(result.is_err());
    }
}
