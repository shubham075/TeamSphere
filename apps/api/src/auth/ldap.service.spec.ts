import { describe, expect, it } from 'vitest';
import { escapeLdapFilter } from './ldap.service';

describe('escapeLdapFilter', () => {
  it('leaves ordinary usernames untouched', () => {
    expect(escapeLdapFilter('priya.sharma')).toBe('priya.sharma');
  });

  it('escapes filter metacharacters so input cannot widen the search', () => {
    expect(escapeLdapFilter('*)(objectClass=*')).toBe('\\2a\\29\\28objectClass=\\2a');
    expect(escapeLdapFilter('a\\b')).toBe('a\\5cb');
    expect(escapeLdapFilter('x\0y')).toBe('x\\00y');
  });
});
