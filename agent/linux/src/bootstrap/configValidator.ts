/**
 * configValidator.ts - Configuration Validation for CodeRalphie
 * 
 * Validates configuration files and environment variables.
 * Ensures all required settings are present and valid.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Configuration structure
 */
export interface RalphieConfig {
  enrollment: {
    url: string;
    timeout_ms: number;
    retry_attempts: number;
  };
  identity: {
    path: string;
    backup_path: string;
  };
  c2: {
    server: string;
    port: number;
    use_wss: boolean;
    reconnect_interval_ms: number;
  };
  tpm: {
    enabled: boolean;
    device_path: string;
    key_handle: string;
  };
  security: {
    fail_visible_mode: boolean;
    reject_unverified: boolean;
    trust_threshold: number;
  };
  logging: {
    level: string;
    path: string;
  };
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: RalphieConfig = {
  enrollment: {
    url: 'https://c2.aethercore.local:3000/api/enrollment',
    timeout_ms: 120000,
    retry_attempts: 3,
  },
  identity: {
    path: '/etc/ralphie/identity.json',
    backup_path: '/etc/ralphie/identity.backup.json',
  },
  c2: {
    server: 'c2.aethercore.local',
    port: 8443,
    use_wss: true,
    reconnect_interval_ms: 5000,
  },
  tpm: {
    enabled: true,
    device_path: '/dev/tpm0',
    key_handle: '0x81000001',
  },
  security: {
    fail_visible_mode: true,
    reject_unverified: true,
    trust_threshold: 0.7,
  },
  logging: {
    level: 'info',
    path: '/var/log/coderalphie',
  },
};

/**
 * Validation errors
 */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validate URL format
 */
function validateURL(url: string, fieldName: string): void {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
      throw new Error(`Invalid protocol for ${fieldName}: ${parsed.protocol}`);
    }
  } catch (error) {
    throw new ConfigValidationError(`Invalid URL for ${fieldName}: ${url}`);
  }
}

/**
 * Validate port number
 */
function validatePort(port: number, fieldName: string): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigValidationError(`Invalid port for ${fieldName}: ${port} (must be 1-65535)`);
  }
}

/**
 * Validate file path
 */
function validatePath(filePath: string, fieldName: string, mustExist: boolean = false): void {
  if (!path.isAbsolute(filePath)) {
    throw new ConfigValidationError(`${fieldName} must be an absolute path: ${filePath}`);
  }
  
  if (mustExist && !fs.existsSync(filePath)) {
    throw new ConfigValidationError(`${fieldName} does not exist: ${filePath}`);
  }
}

/**
 * Validate trust threshold
 */
function validateTrustThreshold(threshold: number): void {
  if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
    throw new ConfigValidationError(`Trust threshold must be between 0 and 1: ${threshold}`);
  }
}

/**
 * Validate configuration object
 */
export function validateConfig(config: RalphieConfig): void {
  // Enrollment validation
  validateURL(config.enrollment.url, 'enrollment.url');
  
  if (config.enrollment.timeout_ms < 1000) {
    throw new ConfigValidationError('enrollment.timeout_ms must be at least 1000ms');
  }
  
  if (config.enrollment.retry_attempts < 0) {
    throw new ConfigValidationError('enrollment.retry_attempts must be non-negative');
  }
  
  // Identity validation
  validatePath(config.identity.path, 'identity.path');
  validatePath(config.identity.backup_path, 'identity.backup_path');
  
  // C2 validation
  if (!config.c2.server || config.c2.server.trim().length === 0) {
    throw new ConfigValidationError('c2.server cannot be empty');
  }
  
  validatePort(config.c2.port, 'c2.port');
  
  if (config.c2.reconnect_interval_ms < 1000) {
    throw new ConfigValidationError('c2.reconnect_interval_ms must be at least 1000ms');
  }
  
  // Production mode: Enforce WSS
  const isProduction = process.env.AETHERCORE_PRODUCTION === '1' || process.env.AETHERCORE_PRODUCTION === 'true';
  if (isProduction && !config.c2.use_wss) {
    throw new ConfigValidationError('PRODUCTION MODE: c2.use_wss must be true (secure WebSocket required)');
  }
  
  // TPM validation
  if (config.tpm.enabled) {
    validatePath(config.tpm.device_path, 'tpm.device_path', false);
    
    if (!config.tpm.key_handle || config.tpm.key_handle.trim().length === 0) {
      throw new ConfigValidationError('tpm.key_handle cannot be empty when TPM is enabled');
    }
    
    // Production mode: Enforce TPM
    if (isProduction && !fs.existsSync(config.tpm.device_path)) {
      throw new ConfigValidationError(
        `PRODUCTION MODE: TPM device not found at ${config.tpm.device_path}. ` +
        'Hardware-rooted trust is required in production.'
      );
    }
  }
  
  // Security validation
  validateTrustThreshold(config.security.trust_threshold);
  
  // Logging validation
  const validLogLevels = ['error', 'warn', 'info', 'debug', 'trace'];
  if (typeof config.security.fail_visible_mode !== 'boolean') {
    throw new ConfigValidationError('security.fail_visible_mode must be boolean');
  }
  
  if (!validLogLevels.includes(config.logging.level)) {
    throw new ConfigValidationError(`logging.level must be one of: ${validLogLevels.join(', ')}`);
  }
  
  validatePath(config.logging.path, 'logging.path');
}

/**
 * Load and validate configuration from file
 */
export function loadConfig(configPath: string): RalphieConfig {
  try {
    if (!fs.existsSync(configPath)) {
      console.warn(`[Config] Config file not found: ${configPath}. Using defaults.`);
      return DEFAULT_CONFIG;
    }
    
    const configJson = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configJson) as RalphieConfig;
    
    // Merge with defaults (fill in missing values)
    const mergedConfig: RalphieConfig = {
      enrollment: { ...DEFAULT_CONFIG.enrollment, ...config.enrollment },
      identity: { ...DEFAULT_CONFIG.identity, ...config.identity },
      c2: { ...DEFAULT_CONFIG.c2, ...config.c2 },
      tpm: { ...DEFAULT_CONFIG.tpm, ...config.tpm },
      security: { ...DEFAULT_CONFIG.security, ...config.security },
      logging: { ...DEFAULT_CONFIG.logging, ...config.logging },
    };
    
    // Validate
    validateConfig(mergedConfig);
    
    console.log('[Config] Configuration loaded and validated successfully');
    return mergedConfig;
    
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw error;
    }
    throw new ConfigValidationError(`Failed to load config: ${error}`);
  }
}

/**
 * Load configuration from environment variables and file
 */
export function loadConfigFromEnvironment(): RalphieConfig {
  // Start with defaults
  let config = { ...DEFAULT_CONFIG };
  
  // Try to load from file
  const configPath = process.env.CONFIG_PATH || '/opt/coderalphie/config/config.json';
  if (fs.existsSync(configPath)) {
    config = loadConfig(configPath);
  }
  
  // Override with environment variables
  if (process.env.ENROLLMENT_URL) {
    config.enrollment.url = process.env.ENROLLMENT_URL;
  }
  
  if (process.env.C2_SERVER) {
    config.c2.server = process.env.C2_SERVER;
  }
  
  if (process.env.C2_PORT) {
    config.c2.port = parseInt(process.env.C2_PORT, 10);
  }
  
  if (process.env.TPM_ENABLED !== undefined) {
    config.tpm.enabled = process.env.TPM_ENABLED === '1' || process.env.TPM_ENABLED === 'true';
  }
  
  if (process.env.LOG_LEVEL) {
    config.logging.level = process.env.LOG_LEVEL;
  }
  
  // Validate final config
  validateConfig(config);
  
  return config;
}

/**
 * Get default configuration
 */
export function getDefaultConfig(): RalphieConfig {
  return { ...DEFAULT_CONFIG };
}
