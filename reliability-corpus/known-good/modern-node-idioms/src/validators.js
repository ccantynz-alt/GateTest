export function validate(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
