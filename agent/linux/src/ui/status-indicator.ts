/**
 * status-indicator.ts - LED Status Indicator for CodeRalphie
 * 
 * Visual feedback system for node state using GPIO/ACT LED.
 * Implements fail-visible philosophy through LED patterns.
 * 
 * LED States:
 * - Blinking Yellow: Onboarding in progress
 * - Solid Green: Operational and trusted
 * - Fast Blinking Red: Integrity failure / TPM error
 * - Slow Blinking Red: Network disconnected
 */

import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * LED Control Mode
 */
enum LEDMode {
  OFF = 'off',
  SOLID = 'solid',
  BLINK_SLOW = 'blink_slow',
  BLINK_FAST = 'blink_fast',
}

/**
 * LED Color (simulated via pattern on single LED)
 */
enum LEDColor {
  RED = 'red',
  YELLOW = 'yellow',
  GREEN = 'green',
}

/**
 * GPIO LED Paths for Raspberry Pi
 */
const GPIO_LED_PATH = '/sys/class/leds/led0'; // ACT LED
const GPIO_TRIGGER = `${GPIO_LED_PATH}/trigger`;
const GPIO_BRIGHTNESS = `${GPIO_LED_PATH}/brightness`;

/**
 * Status Indicator Class
 */
export class StatusIndicator {
  private currentMode: LEDMode = LEDMode.OFF;
  private currentColor: LEDColor = LEDColor.GREEN;
  private blinkInterval: NodeJS.Timeout | null = null;
  private useGPIO: boolean = false;

  constructor() {
    this.init();
  }

  /**
   * Initialize GPIO LED control
   */
  private init(): void {
    try {
      // Check if GPIO LED is available
      if (fs.existsSync(GPIO_LED_PATH)) {
        this.useGPIO = true;
        console.log('[StatusIndicator] GPIO LED available at', GPIO_LED_PATH);
        
        // Set trigger to 'none' for manual control
        fs.writeFileSync(GPIO_TRIGGER, 'none');
      } else {
        this.useGPIO = false;
        console.warn('[StatusIndicator] GPIO LED not available. Using console output only.');
      }
    } catch (error) {
      this.useGPIO = false;
      console.warn('[StatusIndicator] Failed to initialize GPIO:', error);
    }
  }

  /**
   * Set LED brightness (0-255)
   */
  private setBrightness(value: number): void {
    if (this.useGPIO) {
      try {
        fs.writeFileSync(GPIO_BRIGHTNESS, value.toString());
      } catch (error) {
        console.error('[StatusIndicator] Failed to set brightness:', error);
      }
    }
  }

  /**
   * Turn LED on
   */
  private ledOn(): void {
    this.setBrightness(255);
    console.log(`[StatusIndicator] LED ON (${this.currentColor})`);
  }

  /**
   * Turn LED off
   */
  private ledOff(): void {
    this.setBrightness(0);
    console.log('[StatusIndicator] LED OFF');
  }

  /**
   * Stop any active blinking
   */
  private stopBlinking(): void {
    if (this.blinkInterval) {
      clearInterval(this.blinkInterval);
      this.blinkInterval = null;
    }
  }

  /**
   * Start blinking pattern
   */
  private startBlinking(intervalMs: number): void {
    this.stopBlinking();
    
    let isOn = false;
    this.blinkInterval = setInterval(() => {
      if (isOn) {
        this.ledOff();
      } else {
        this.ledOn();
      }
      isOn = !isOn;
    }, intervalMs);
  }

  /**
   * Set LED to solid color
   */
  private setSolid(color: LEDColor): void {
    this.stopBlinking();
    this.currentColor = color;
    this.currentMode = LEDMode.SOLID;
    this.ledOn();
  }

  /**
   * Blinking Yellow - Onboarding in progress
   */
  public async setBlinkingYellow(): Promise<void> {
    console.log('[StatusIndicator] 🟡 BLINKING YELLOW: Onboarding in progress');
    this.currentColor = LEDColor.YELLOW;
    this.currentMode = LEDMode.BLINK_SLOW;
    this.startBlinking(500); // 500ms interval (medium blink)
  }

  /**
   * Solid Green - Onboarding complete, operational
   */
  public async setSolidGreen(): Promise<void> {
    console.log('[StatusIndicator] 🟢 SOLID GREEN: Onboarding complete, operational');
    this.setSolid(LEDColor.GREEN);
  }

  /**
   * Fast Blinking Red - Integrity failure / TPM error
   */
  public async setFastBlinkingRed(): Promise<void> {
    console.log('[StatusIndicator] 🔴 FAST BLINKING RED: Integrity failure / TPM error');
    this.currentColor = LEDColor.RED;
    this.currentMode = LEDMode.BLINK_FAST;
    this.startBlinking(200); // 200ms interval (fast blink)
  }

  /**
   * Slow Blinking Red - Network disconnected
   */
  public async setSlowBlinkingRed(): Promise<void> {
    console.log('[StatusIndicator] 🔴 SLOW BLINKING RED: Network disconnected');
    this.currentColor = LEDColor.RED;
    this.currentMode = LEDMode.BLINK_SLOW;
    this.startBlinking(1000); // 1000ms interval (slow blink)
  }

  /**
   * Turn off LED
   */
  public async setOff(): Promise<void> {
    console.log('[StatusIndicator] LED OFF');
    this.stopBlinking();
    this.currentMode = LEDMode.OFF;
    this.ledOff();
  }

  /**
   * Get current status
   */
  public getStatus(): { mode: LEDMode; color: LEDColor } {
    return {
      mode: this.currentMode,
      color: this.currentColor,
    };
  }

  /**
   * Cleanup on shutdown
   */
  public cleanup(): void {
    this.stopBlinking();
    this.ledOff();
    console.log('[StatusIndicator] Cleanup complete');
  }
}

/**
 * Global status indicator instance
 */
let globalIndicator: StatusIndicator | null = null;

/**
 * Get or create status indicator
 */
export function getStatusIndicator(): StatusIndicator {
  if (!globalIndicator) {
    globalIndicator = new StatusIndicator();
  }
  return globalIndicator;
}

/**
 * Cleanup status indicator on process exit
 */
process.on('exit', () => {
  if (globalIndicator) {
    globalIndicator.cleanup();
  }
});

process.on('SIGINT', () => {
  if (globalIndicator) {
    globalIndicator.cleanup();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (globalIndicator) {
    globalIndicator.cleanup();
  }
  process.exit(0);
});
