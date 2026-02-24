use std::env;

#[derive(Clone)]
pub struct Config {
    pub port: u16,
    pub redis_url: String,
    #[allow(dead_code)]
    pub kms_key_arn: String,
    pub merkle_bucket: String,
    pub buffer_size: usize,
}

impl Config {
    pub fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        Ok(Config {
            port: env::var("PORT")?.parse().unwrap_or(8090),
            redis_url: env::var("REDIS_URL")?,
            kms_key_arn: env::var("KMS_KEY_ARN")?,
            merkle_bucket: env::var("MERKLE_BUCKET")?,
            buffer_size: env::var("BUFFER_SIZE")?.parse().unwrap_or(65536),
        })
    }
}
