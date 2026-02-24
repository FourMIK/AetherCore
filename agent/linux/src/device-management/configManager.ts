/**
 * configManager.ts - Runtime Configuration Management
 * 
 * Manages configuration state and provides access to settings.
 * Handles secure storage and validation of configuration.
 */

import * as fs from 'fs';
import * as path from 'path';
import { RalphieConfig, loadConfigFromEnvironment, validateConfig } from '../bootstrap/configValidator';

/**
 * Configuration Manager
 */
export class ConfigManager {
  private config: RalphieConfig;
  private configPath: string;
  private watchers: Map<string, ((config: RalphieConfig) => void)[]>;

  constructor(configPath?: string) {
    this.configPath = configPath || process.env.CONFIG_PATH || '/opt/coderalphie/config/config.json';
    this.watchers = new Map();
    this.config = loadConfigFromEnvironment();
  }

  /**
   * Get current configuration
   */
  public getConfig(): Readonly<RalphieConfig> {
    return Object.freeze({ ...this.config });
  }

  /**
   * Get enrollment configuration
   */
  public getEnrollmentConfig() {
    return this.config.enrollment;
  }

  /**
   * Get identity configuration
   */
  public getIdentityConfig() {
    return this.config.identity;
  }

  /**
   * Get C2 configuration
   */
  public getC2Config() {
    return this.config.c2;
  }

  /**
   * Get TPM configuration
   */
  public getTPMConfig() {
    return this.config.tpm;
  }

  /**
   * Get security configuration
   */
  public getSecurityConfig() {
    return this.config.security;
  }

  /**
   * Get logging configuration
   */
  public getLoggingConfig() {
    return this.config.logging;
  }

  /**
   * Update configuration (validates before applying)
   */
  public updateConfig(newConfig: Partial<RalphieConfig>): void {
    const mergedConfig = {
      ...this.config,
      ...newConfig,
    };

    // Validate before applying
    validateConfig(mergedConfig);

    this.config = mergedConfig;
    this.notifyWatchers();

    console.log('[ConfigManager] Configuration updated');
  }

  /**
   * Reload configuration from file
   */
  public reloadConfig(): void {
    console.log('[ConfigManager] Reloading configuration...');
    
    try {
      this.config = loadConfigFromEnvironment();
      this.notifyWatchers();
      console.log('[ConfigManager] Configuration reloaded successfully');
    } catch (error) {
      console.error('[ConfigManager] Failed to reload configuration:', error);
      throw error;
    }
  }

  /**
   * Save configuration to file
   */
  public saveConfig(targetPath?: string): void {
    const savePath = targetPath || this.configPath;
    
    console.log('[ConfigManager] Saving configuration to', savePath);
    
    try {
      // Ensure directory exists
      const dir = path.dirname(savePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      
      // Write configuration
      const configJson = JSON.stringify(this.config, null, 2);
      fs.writeFileSync(savePath, configJson, { mode: 0o600 });
      
      console.log('[ConfigManager] Configuration saved successfully');
    } catch (error) {
      console.error('[ConfigManager] Failed to save configuration:', error);
      throw error;
    }
  }

  /**
   * Watch for configuration changes
   */
  public watch(category: string, callback: (config: RalphieConfig) => void): void {
    if (!this.watchers.has(category)) {
      this.watchers.set(category, []);
    }
    this.watchers.get(category)!.push(callback);
  }

  /**
   * Unwatch configuration changes
   */
  public unwatch(category: string, callback: (config: RalphieConfig) => void): void {
    const callbacks = this.watchers.get(category);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Notify watchers of configuration change
   */
  private notifyWatchers(): void {
    this.watchers.forEach((callbacks) => {
      callbacks.forEach((callback) => {
        try {
          callback(this.getConfig());
        } catch (error) {
          console.error('[ConfigManager] Watcher callback error:', error);
        }
      });
    });
  }

  /**
   * Validate current configuration
   */
  public validate(): boolean {
    try {
      validateConfig(this.config);
      return true;
    } catch (error) {
      console.error('[ConfigManager] Validation failed:', error);
      return false;
    }
  }

  /**
   * Export configuration for backup
   */
  public exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Import configuration from JSON
   */
  public importConfig(configJson: string): void {
    try {
      const newConfig = JSON.parse(configJson) as RalphieConfig;
      validateConfig(newConfig);
      this.config = newConfig;
      this.notifyWatchers();
      console.log('[ConfigManager] Configuration imported successfully');
    } catch (error) {
      console.error('[ConfigManager] Failed to import configuration:', error);
      throw error;
    }
  }
}

/**
 * Global configuration manager instance
 */
let globalConfigManager: ConfigManager | null = null;

/**
 * Get or create configuration manager
 */
export function getConfigManager(): ConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = new ConfigManager();
  }
  return globalConfigManager;
}

/**
 * Initialize configuration manager with custom path
 */
export function initConfigManager(configPath: string): ConfigManager {
  globalConfigManager = new ConfigManager(configPath);
  return globalConfigManager;
}
