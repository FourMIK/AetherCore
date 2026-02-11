export type ParsedTpmEnabled = {
  value: boolean;
  warning?: string;
};

export function parseTpmEnabled(rawValue: string | undefined): ParsedTpmEnabled {
  if (rawValue === undefined || rawValue.trim() === '') {
    return { value: true };
  }

  const normalized = rawValue.toLowerCase().trim();
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return { value: false };
  }

  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return { value: true };
  }

  return {
    value: true,
    warning: 'Invalid TPM_ENABLED value, defaulting to true. Valid values: true/false, 1/0, yes/no, on/off',
  };
}
