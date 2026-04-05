/** Registration-time policy. Login still accepts older passwords created before this policy. */
export function assertStrongPassword(password: string): void {
  if (typeof password !== 'string') throw new Error('Invalid password');
  if (password.length < 10 || password.length > 128) {
    throw new Error('Password must be between 10 and 128 characters');
  }
  if (/\s/.test(password)) {
    throw new Error('Password must not contain spaces');
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('Password must include at least one letter and one number');
  }
}
