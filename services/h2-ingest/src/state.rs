use aws_sdk_kms::Client as KmsClient;
use aws_sdk_s3::Client as S3Client;
use redis::Client as RedisClient;

use crate::config::Config;

pub struct AppState {
    pub config: Config,
    pub redis: RedisClient,
    pub s3: S3Client,
    #[allow(dead_code)]
    pub kms: KmsClient,
}

impl AppState {
    pub async fn new(config: Config) -> Result<Self, Box<dyn std::error::Error>> {
        let aws_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
        
        let redis = RedisClient::open(config.redis_url.as_str())?;
        let s3 = S3Client::new(&aws_config);
        let kms = KmsClient::new(&aws_config);

        Ok(AppState {
            config,
            redis,
            s3,
            kms,
        })
    }
}
